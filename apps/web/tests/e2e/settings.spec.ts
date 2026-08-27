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

async function stubVehicleDocumentAiSettings(page: Page): Promise<void> {
  await page.route("**/api/ai/vehicle-document/settings", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "openai",
        openAiModel: "gpt-4.1-nano",
        hasOpenAiKey: false,
        hasGoogleKey: false,
        openAiKeyMask: null,
        googleKeyMask: null,
        updatedAt: null,
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await stubVehicleDocumentAiSettings(page);
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test.describe("AI 安全首屏", () => {
  test.use({ javaScriptEnabled: false });

  test("服务器首屏也显示 AI 已关闭", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-ai-provider")).toHaveValue("off");
    await expect(page.getByText("已关闭", { exact: true })).toBeVisible();
  });
});

test("系统设置：AI 默认关闭，可明确启用并持久化设置（#5）", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "系统设置" })).toBeVisible();
  const card = page.getByTestId("settings-ai-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("AI 服务（DeepSeek）");

  // 新浏览器默认关闭，且不预填任何凭据。
  await expect(page.getByTestId("settings-ai-provider")).toHaveValue("off");
  const keyValue = await page.getByTestId("settings-ai-key").inputValue();
  expect(keyValue).toBe("");
  await expect(page.getByTestId("settings-ai-test")).toBeDisabled();

  // 用户明确启用后，测试值才可保存到当前浏览器上下文。
  await page.getByTestId("settings-ai-provider").selectOption("deepseek");
  await page.getByTestId("settings-ai-key").fill("sk-my-new-key-123");
  await page.getByTestId("settings-ai-save").click();
  await expect(page.getByTestId("settings-ai-saved")).toContainText("已保存");
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_ai_settings_v1");
    return raw ? (JSON.parse(raw) as { provider: string; apiKey: string }) : null;
  });
  expect(stored?.apiKey).toBe("sk-my-new-key-123");

  // 关闭 AI → 测试连接按钮禁用
  await page.getByTestId("settings-ai-provider").selectOption("off");
  await page.getByTestId("settings-ai-save").click();
  await expect(page.getByTestId("settings-ai-test")).toBeDisabled();
  const storedOff = await page.evaluate(() => JSON.parse(localStorage.getItem("wh_ai_settings_v1") ?? "{}") as { provider: string });
  expect(storedOff.provider).toBe("off");
});


test("AI 模型下拉：默认快速模型，可选最强推理模型并持久化（8/18 老板问）", async ({ page }) => {
  await page.goto("/settings");
  const modelSelect = page.getByTestId("settings-ai-model");
  // 默认快速模型
  await expect(modelSelect).toHaveValue("deepseek-chat");
  await expect(modelSelect.locator("option")).toHaveCount(3);
  await expect(modelSelect.locator('option[value="deepseek-reasoner"]')).toHaveCount(1);

  // 切到最强推理模型 → 保存 → localStorage 持久化
  await modelSelect.selectOption("deepseek-reasoner");
  await page.getByTestId("settings-ai-save").click();
  await expect(page.getByTestId("settings-ai-saved")).toContainText("已保存");
  const storedReasoner = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_ai_settings_v1");
    return raw ? (JSON.parse(raw) as { model: string }) : null;
  });
  expect(storedReasoner?.model).toBe("deepseek-reasoner");

  // 自定义模型名：出现输入框，保存任意模型名
  await modelSelect.selectOption("custom");
  await expect(page.getByTestId("settings-ai-model-custom")).toBeVisible();
  await page.getByTestId("settings-ai-model-custom").fill("deepseek-chat");
  await page.getByTestId("settings-ai-save").click();
  const storedCustom = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_ai_settings_v1");
    return raw ? (JSON.parse(raw) as { model: string }) : null;
  });
  expect(storedCustom?.model).toBe("deepseek-chat");
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
