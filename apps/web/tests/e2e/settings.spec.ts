import { expect, test, type Page } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

const PRIMARY_KEY = "wh_linked_operations_state_v1";
const QUICK_PARKING_KEY = "wh_quick_parking_v1";
const QUICK_PARKING_RAW = '{"revision":1,"cases":[{"id":"qpark-settings-broken"}],"previews":[';
const ROTATION_KEYS = ["wh_quick_rotation_v1", "wh_quick_rotation_used_v1"] as const;
const UNRELATED_KEY = "wh_settings_reset_unrelated_sentinel";

type SettingsProbeEntry = {
  readonly kind: "set" | "remove" | "clear";
  readonly key: string | null;
};

async function installSettingsProtectionProbe(page: Page): Promise<void> {
  await page.addInitScript(({ primaryKey, quickKey, quickRaw, rotationKeys, unrelatedKey }) => {
    const markerKey = "wh_e2e_settings_protection_seeded";
    const probeKey = "wh_e2e_settings_protection_probe";
    const navigationKey = "wh_e2e_settings_document_count";
    const originalStorageSet = Storage.prototype.setItem;
    const originalStorageRemove = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    if (window.sessionStorage.getItem(markerKey) !== "1") {
      originalStorageSet.call(window.localStorage, quickKey, quickRaw);
      for (const key of rotationKeys) originalStorageSet.call(window.localStorage, key, `rotation:${key}`);
      originalStorageSet.call(window.localStorage, unrelatedKey, "unrelated-must-survive");
      originalStorageSet.call(window.sessionStorage, markerKey, "1");
      originalStorageSet.call(window.sessionStorage, probeKey, "[]");
      originalStorageSet.call(window.sessionStorage, navigationKey, "0");
    }
    originalStorageSet.call(
      window.sessionStorage,
      navigationKey,
      String(Number(window.sessionStorage.getItem(navigationKey) ?? "0") + 1),
    );
    const scope = window as typeof window & { __WH_SETTINGS_PROBE__?: SettingsProbeEntry[] };
    const readProbe = (): SettingsProbeEntry[] => {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(probeKey) ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed as SettingsProbeEntry[] : [];
      } catch {
        return [];
      }
    };
    const record = (entry: SettingsProbeEntry): void => {
      const next = [...readProbe(), entry];
      scope.__WH_SETTINGS_PROBE__ = next;
      originalStorageSet.call(window.sessionStorage, probeKey, JSON.stringify(next));
    };
    scope.__WH_SETTINGS_PROBE__ = readProbe();
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (this === window.localStorage) record({ kind: "set", key });
      originalStorageSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string): void {
      if (this === window.localStorage) record({ kind: "remove", key });
      originalStorageRemove.call(this, key);
    };
    Storage.prototype.clear = function clear(): void {
      if (this === window.localStorage) record({ kind: "clear", key: null });
      originalStorageClear.call(this);
    };

    void primaryKey;
  }, {
    primaryKey: PRIMARY_KEY,
    quickKey: QUICK_PARKING_KEY,
    quickRaw: QUICK_PARKING_RAW,
    rotationKeys: ROTATION_KEYS,
    unrelatedKey: UNRELATED_KEY,
  });
}

async function resetSettingsProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & { __WH_SETTINGS_PROBE__?: SettingsProbeEntry[] }).__WH_SETTINGS_PROBE__ = [];
    window.sessionStorage.setItem("wh_e2e_settings_protection_probe", "[]");
  });
}

async function stubAiSettings(page: Page): Promise<void> {
  type ProviderId = "deepseek" | "openai" | "google" | "compatible";
  type StubSettings = {
    version: number;
    providers: Record<ProviderId, { enabled: boolean; hasKey: boolean; keyMask: string | null; baseUrl: string | null }>;
    routes: Record<string, { enabled: boolean; autoFallback: boolean; steps: Array<{ provider: string; model: string }> }>;
    updatedAt: string | null;
    recentEvents: unknown[];
  };
  const settings: StubSettings = {
    version: 2,
    providers: {
      deepseek: { enabled: true, hasKey: false, keyMask: null, baseUrl: null },
      openai: { enabled: true, hasKey: true, keyMask: "••••1234", baseUrl: null },
      google: { enabled: true, hasKey: false, keyMask: null, baseUrl: null },
      compatible: { enabled: false, hasKey: false, keyMask: null, baseUrl: null },
    },
    routes: {
      text: { enabled: true, autoFallback: true, steps: [{ provider: "deepseek", model: "deepseek-chat" }, { provider: "openai", model: "gpt-4.1-mini" }] },
      customer_license: { enabled: true, autoFallback: true, steps: [{ provider: "openai", model: "gpt-4.1" }, { provider: "google", model: "document-text" }] },
      vehicle_document: { enabled: true, autoFallback: true, steps: [{ provider: "openai", model: "gpt-4.1-mini" }, { provider: "google", model: "document-text" }] },
    },
    updatedAt: null,
    recentEvents: [],
  };
  await page.route("**/api/ai/settings", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        providers?: Partial<Record<ProviderId, { enabled?: boolean; apiKey?: string; baseUrl?: string }>>;
        routes?: StubSettings["routes"];
      };
      if (body.routes) settings.routes = body.routes;
      for (const id of Object.keys(settings.providers) as Array<keyof typeof settings.providers>) {
        const update = body.providers?.[id] as { enabled?: boolean; apiKey?: string; baseUrl?: string } | undefined;
        if (!update) continue;
        settings.providers[id].enabled = update.enabled ?? settings.providers[id].enabled;
        if (update.apiKey) { settings.providers[id].hasKey = true; settings.providers[id].keyMask = `••••${update.apiKey.slice(-4)}`; }
        if (id === "compatible") settings.providers[id].baseUrl = update.baseUrl || null;
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(settings) });
  });
}

async function stubEmptyMasterData(page: Page): Promise<void> {
  await page.route("**/api/formal/master-data", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dictionaries: [], staff: [], teams: [], payrollParameters: [], teamCommissionRates: [] }) });
  });
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await stubAiSettings(page);
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("系统设置：统一展示四个服务商和三条任务路线，密钥不写入浏览器", async ({ page }) => {
  await stubEmptyMasterData(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "系统设置" })).toBeVisible();
  await expect(page.getByTestId("ai-service-center")).toBeVisible();
  for (const provider of ["deepseek", "openai", "google", "compatible"]) await expect(page.getByTestId(`ai-provider-${provider}`)).toBeVisible();
  for (const task of ["text", "customer_license", "vehicle_document"]) await expect(page.getByTestId(`ai-route-${task}`)).toBeVisible();
  await page.getByTestId("ai-provider-deepseek").locator('input[type="password"]').fill("sk-my-new-key-123");
  await page.getByTestId("ai-center-save").click();
  await expect(page.getByTestId("ai-center-notice")).toContainText("已保存");
  expect(await page.evaluate(() => localStorage.getItem("wh_ai_settings_v1"))).toBeNull();
  await page.setViewportSize({ width: 1920, height: 1600 });
  await page.getByTestId("ai-service-center").screenshot({ path: "../qa/visual/ai-service-center-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByTestId("ai-service-center").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../qa/visual/ai-service-center-mobile.png" });
});

test("绩效参数入口：设置全厂默认、维修组特殊比例并恢复默认", async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/formal/master-data", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posts.push(body);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dictionaries: [],
        staff: [],
        teams: [{ id: 7, teamNo: "TEAM-202608-0001", name: "维修一组", isActive: true, version: 1 }, {
          id: 8, teamNo: "TEAM-202608-0002", name: "维修二组", isActive: true, version: 1,
        }],
        payrollParameters: [{ effectiveMonth: "2026-08", commissionRate: "0.250000", cnyToJmdRate: "22.000000" }],
        teamCommissionRates: [],
      }),
    });
  });

  await page.goto("/settings#performance-parameters");
  const card = page.getByTestId("settings-performance-parameters");
  await expect(card).toBeVisible();
  await expect(card).toContainText("全厂月度参数");
  await expect(card).toContainText("25%");
  await expect(card).toContainText("1 CNY = 22 JMD");

  await page.getByTestId("performance-global-month").fill("2026-09");
  await page.getByTestId("performance-global-commission").fill("30");
  await page.getByTestId("performance-global-exchange").fill("23.5");
  await page.getByTestId("performance-global-save").click();
  await expect(page.getByTestId("performance-parameters-notice")).toContainText("全厂参数已保存");

  await page.getByTestId("performance-team-select").selectOption("8");
  await page.getByTestId("performance-team-month").fill("2026-09");
  await page.getByTestId("performance-team-commission").fill("20");
  await page.getByTestId("performance-team-save").click();
  await expect(page.getByTestId("performance-parameters-notice")).toContainText("特殊比例已保存");

  await page.getByTestId("performance-team-month").fill("2026-10");
  await page.getByTestId("performance-team-restore").click();
  await expect(page.getByTestId("performance-parameters-notice")).toContainText("恢复全厂默认");

  expect(posts).toEqual([{
    action: "set_payroll_parameters",
    effectiveMonth: "2026-09",
    commissionRate: "0.3",
    cnyToJmdRate: "23.5",
  }, {
    action: "set_team_commission_rate",
    teamId: 8,
    effectiveMonth: "2026-09",
    commissionRate: "0.2",
  }, {
    action: "set_team_commission_rate",
    teamId: 8,
    effectiveMonth: "2026-10",
    commissionRate: null,
  }]);
});


test("AI 任务路线：模型可修改且服务顺序可调整", async ({ page }) => {
  await stubEmptyMasterData(page);
  await page.goto("/settings");
  const route = page.getByTestId("ai-route-text");
  await route.getByLabel("文本拆单与翻译第1模型").fill("deepseek-reasoner");
  await route.getByRole("button", { name: "下移" }).first().click();
  await expect(route.getByLabel("文本拆单与翻译第1服务")).toHaveValue("openai");
  await page.getByTestId("ai-center-save").click();
  await expect(page.getByTestId("ai-center-notice")).toContainText("已保存");
});

test("重置演示偏好只清偏好，不清业务账本或无关设置", async ({ page }) => {
  await installSettingsProtectionProbe(page);
  await page.goto("/payments");
  await expect(page.getByTestId("payments-table")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("settings-demo-card")).toBeVisible();
  const before = await page.evaluate(({ primaryKey, quickKey, rotationKeys, unrelatedKey }) => ({
    primary: window.localStorage.getItem(primaryKey),
    quick: window.localStorage.getItem(quickKey),
    rotations: rotationKeys.map((key) => window.localStorage.getItem(key)),
    unrelated: window.localStorage.getItem(unrelatedKey),
    documentCount: Number(window.sessionStorage.getItem("wh_e2e_settings_document_count")),
  }), {
    primaryKey: PRIMARY_KEY,
    quickKey: QUICK_PARKING_KEY,
    rotationKeys: ROTATION_KEYS,
    unrelatedKey: UNRELATED_KEY,
  });
  expect(before.primary).not.toBeNull();
  expect(before.quick).toBe(QUICK_PARKING_RAW);
  expect(before.rotations).toEqual(ROTATION_KEYS.map((key) => `rotation:${key}`));
  expect(before.unrelated).toBe("unrelated-must-survive");
  const documentMarker = await page.evaluate(() => {
    const marker = crypto.randomUUID();
    document.documentElement.dataset.settingsDocumentMarker = marker;
    return marker;
  });
  await resetSettingsProbe(page);
  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.getByTestId("settings-reset-demo").click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("settings-reset-demo")).toBeVisible();
  const after = await page.evaluate(({ primaryKey, quickKey, rotationKeys, unrelatedKey }) => ({
    primary: window.localStorage.getItem(primaryKey),
    quick: window.localStorage.getItem(quickKey),
    rotations: rotationKeys.map((key) => window.localStorage.getItem(key)),
    unrelated: window.localStorage.getItem(unrelatedKey),
    documentCount: Number(window.sessionStorage.getItem("wh_e2e_settings_document_count")),
    documentMarker: document.documentElement.dataset.settingsDocumentMarker ?? null,
    operations: [...((window as typeof window & { __WH_SETTINGS_PROBE__?: SettingsProbeEntry[] }).__WH_SETTINGS_PROBE__ ?? [])],
  }), {
    primaryKey: PRIMARY_KEY,
    quickKey: QUICK_PARKING_KEY,
    rotationKeys: ROTATION_KEYS,
    unrelatedKey: UNRELATED_KEY,
  });
  expect(after.primary).toBe(before.primary);
  expect(after.quick).toBe(before.quick);
  expect(after.rotations).toEqual([null, null]);
  expect(after.unrelated).toBe(before.unrelated);
  expect(after.documentCount).toBe(before.documentCount);
  expect(after.documentMarker).toBe(documentMarker);
  expect(after.operations).toEqual(ROTATION_KEYS.map((key) => ({ kind: "remove", key })));
});


test("支付方式字典：默认三项小方块，可添加自定义方式并删除（8/18 老板）", async ({ page }) => {
  await page.goto("/dictionaries");
  await page.getByTestId("dictionary-tab-payment-methods").click();
  const card = page.getByTestId("settings-methods-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("settings-method-cash")).toBeVisible();
  await expect(page.getByTestId("settings-method-card")).toBeVisible();
  await expect(page.getByTestId("settings-method-bank_transfer")).toBeVisible();
  // 添加自定义方式
  await page.getByTestId("settings-method-add-input").fill("银行转账-BNS");
  await page.getByTestId("settings-method-add").click();
  await expect(page.getByTestId("settings-method-notice")).toContainText("已添加");
  const custom = page.locator('[data-testid^="settings-method-custom-"]');
  await expect(custom).toHaveCount(1);
  await expect(page.getByTestId("settings-method-name-custom-1")).toHaveValue("银行转账-BNS");
  // 删除
  await custom.getByRole("button", { name: "删除银行转账-BNS" }).click();
  await expect(page.locator('[data-testid^="settings-method-custom-"]')).toHaveCount(0);
});
test("维修班组字典：不预设虚构班组，可新增、改名并删除", async ({ page }) => {
  await page.goto("/dictionaries");
  const card = page.getByTestId("settings-teams-card");
  await expect(card).toBeVisible();
  await expect(page.locator('[data-testid^="settings-team-name-"]')).toHaveCount(0);
  await page.getByTestId("settings-team-add-input").fill("实际维修班组");
  await page.getByTestId("settings-team-add").click();
  await expect(page.getByTestId("settings-team-notice")).toContainText("已添加班组");
  await expect(page.getByTestId("settings-team-name-t1")).toHaveValue("实际维修班组");

  await page.getByTestId("settings-team-name-t1").fill("实际维修班组 A");
  await page.getByTestId("settings-team-rename-t1").click();
  await expect(page.getByTestId("settings-team-notice")).toContainText("已更新");
  await page.getByTestId("settings-team-remove-t1").click();
  await expect(page.locator('[data-testid^="settings-team-name-"]')).toHaveCount(0);
});

test("已使用班组删除前必须选择继承班组并转移员工与 BO", async ({ page }) => {
  await page.goto("/dictionaries#teams");
  await page.getByTestId("settings-team-add-input").fill("待删除维修组");
  await page.getByTestId("settings-team-add").click();
  await page.getByTestId("settings-team-add-input").fill("继承维修组");
  await page.getByTestId("settings-team-add").click();

  await page.goto("/employees?create=1&team=t1");
  await expect(page.getByTestId("employee-form")).toBeVisible();
  await expect(page.getByTestId("employee-team")).toHaveValue("t1");
  await page.getByTestId("employee-name").fill("待转移维修工");
  await page.getByTestId("employee-save").click();

  await page.goto("/orders/business/demo-v2-provisional");
  await page.getByTestId("quick-perf-assign-open").click();
  await page.getByTestId("quick-assign-team-t1").click();
  await page.getByTestId("quick-assign-confirm").click();
  await expect(page.getByTestId("quick-perf-team")).toHaveText("待删除维修组");

  await page.goto("/dictionaries#teams");
  await page.getByTestId("settings-team-remove-t1").click();
  await expect(page.getByTestId("team-replacement-dialog")).toBeVisible();
  await expect(page.getByTestId("team-replacement-summary")).toContainText("1 名员工");
  await expect(page.getByTestId("team-replacement-summary")).toContainText("1 张 BO");
  await page.getByTestId("team-replacement-select").selectOption("t2");
  await page.getByTestId("team-replacement-confirm").click();
  await expect(page.getByTestId("settings-team-name-t1")).toHaveCount(0);
  await expect(page.getByTestId("settings-team-notice")).toContainText("已由“继承维修组”继承");

  await page.goto("/employees");
  await expect(page.getByTestId("employee-row")).toContainText("继承维修组");
  await expect(page.getByTestId("employee-row")).toContainText("账号 ID");

  await page.goto("/orders/business/demo-v2-provisional");
  await expect(page.getByTestId("quick-perf-team")).toHaveText("继承维修组");
});

test("班组行可直接新增成员账号并自动带入班组", async ({ page }) => {
  await page.goto("/dictionaries#teams");
  await page.getByTestId("settings-team-add-input").fill("快速成员组");
  await page.getByTestId("settings-team-add").click();
  await page.getByTestId("settings-team-add-member-t1").click();
  await expect(page).toHaveURL(/\/employees\?create=1&team=t1$/);
  await expect(page.getByTestId("employee-form")).toBeVisible();
  await expect(page.getByTestId("employee-team")).toHaveValue("t1");
  await page.getByTestId("employee-name").fill("快速新增成员");
  await page.getByTestId("employee-save").click();
  await expect(page.getByTestId("employee-row")).toContainText("快速新增成员");
  await expect(page.getByTestId("employee-row")).toContainText("账号 ID：emp-custom-1");
});

test("收费单位字典：标准单位可修改并可新增、修改、删除自定义单位", async ({ page }) => {
  await page.goto("/dictionaries");
  await page.getByTestId("dictionary-tab-charge-units").click();
  await expect(page.getByTestId("dictionary-units-card")).toBeVisible();
  await expect(page.getByTestId("dictionary-unit-name-work_hour")).toHaveValue("工时");
  await page.getByTestId("dictionary-unit-add-zh").fill("桶");
  await page.getByTestId("dictionary-unit-add-en").fill("pail");
  await page.getByTestId("dictionary-unit-add").click();
  await expect(page.getByTestId("dictionary-unit-name-custom-unit-1")).toHaveValue("桶");
  await page.getByTestId("dictionary-unit-name-custom-unit-1").fill("桶装");
  await page.getByTestId("dictionary-unit-save-custom-unit-1").click();
  await expect(page.getByTestId("dictionary-unit-notice")).toContainText("已更新");
  await page.getByTestId("dictionary-unit-remove-custom-unit-1").click();
  await expect(page.getByTestId("dictionary-unit-name-custom-unit-1")).toHaveCount(0);
});

test("员工管理：可新增、修改并删除实际员工", async ({ page }) => {
  await page.goto("/employees");
  await expect(page.getByRole("heading", { level: 1, name: "员工管理" })).toBeVisible();
  await expect(page.getByTestId("employee-row")).toHaveCount(0);

  await page.getByTestId("employee-add-open").click();
  await page.getByTestId("employee-name").fill("测试员工");
  await page.getByTestId("employee-role").selectOption("frontdesk_admin");
  await page.getByTestId("employee-save").click();
  await expect(page.getByTestId("employee-notice")).toContainText("员工已新增");
  await expect(page.getByTestId("employee-row")).toContainText("测试员工");

  await page.getByTestId("employee-edit-emp-custom-1").click();
  await page.getByTestId("employee-name").fill("正式员工");
  await page.getByTestId("employee-save").click();
  await expect(page.getByTestId("employee-row")).toContainText("正式员工");

  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.getByTestId("employee-remove-emp-custom-1").click();
  await expect(page.getByTestId("employee-row")).toHaveCount(0);
});

test("基础字典驱动员工归组和 BO 派单，不允许手填不存在的班组或维修工", async ({ page }) => {
  await page.goto("/dictionaries");
  await page.getByTestId("settings-team-add-input").fill("验收维修班组");
  await page.getByTestId("settings-team-add").click();

  await page.goto("/employees");
  await page.getByTestId("employee-add-open").click();
  await page.getByTestId("employee-name").fill("验收维修工");
  await page.getByTestId("employee-role").selectOption("mechanic");
  await page.getByTestId("employee-team").selectOption("t1");
  await page.getByTestId("employee-save").click();

  await page.goto("/orders/business/demo-v2-provisional");
  await page.getByTestId("quick-perf-assign-open").click();
  await expect(page.getByTestId("quick-assign-teams")).toContainText("验收维修班组");
  await expect(page.getByTestId("quick-assign-teams")).not.toContainText("车间一组");
  await page.getByTestId("quick-assign-team-t1").click();
  await page.getByTestId("quick-assign-mechanic").selectOption({ label: "验收维修工" });
  await page.getByTestId("quick-assign-confirm").click();
  await expect(page.getByTestId("quick-perf-team")).toHaveText("验收维修班组");
  await expect(page.getByTestId("quick-perf-mechanic")).toContainText("验收维修工");
});
