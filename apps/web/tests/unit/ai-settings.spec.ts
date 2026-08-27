import { expect, test } from "@playwright/test";
import {
  AI_MODEL_PRESETS,
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_DEEPSEEK_MODEL,
  aiEnabled,
  isReasoningModel,
  loadAiSettings,
  saveAiSettings,
} from "../../src/lib/ai/settings";
import { aiParseQuickOrder, aiTranslateRepair } from "../../src/lib/ai/auto-repair";

function withBrowserStorage(run: (storage: Storage) => void): void {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    run(storage);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("未保存浏览器 AI 设置时默认关闭，且不提供客户端密钥", () => {
  // 捕获生产缺陷：全新浏览器会因内置客户端密钥而自动启用 DeepSeek。
  withBrowserStorage(() => {
    const defaults = loadAiSettings();
    expect(defaults.provider).toBe("off");
    expect(defaults.apiKey).toBe("");
    expect(defaults.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(aiEnabled()).toBe(false);
  });
});

test("显式保存非空 DeepSeek 设置后仍能启用，关闭开关能生效", () => {
  withBrowserStorage((storage) => {
    saveAiSettings({ provider: "deepseek", apiKey: "test-only-key", model: "deepseek-chat" });
    expect(loadAiSettings()).toEqual({
      provider: "deepseek",
      apiKey: "test-only-key",
      model: "deepseek-chat",
    });
    expect(aiEnabled()).toBe(true);

    saveAiSettings({ provider: "off", apiKey: "", model: "deepseek-chat" });
    expect(loadAiSettings().provider).toBe("off");
    expect(aiEnabled()).toBe(false);
    storage.removeItem(AI_SETTINGS_STORAGE_KEY);
  });
});

test("模型预设：默认快速模型，下拉包含最强推理与自定义（8/18 老板问）", () => {
  expect(DEFAULT_DEEPSEEK_MODEL).toBe("deepseek-chat");
  expect(AI_MODEL_PRESETS.map((item) => item.value)).toEqual(["deepseek-chat", "deepseek-reasoner", "custom"]);
});

test("推理模型识别：reasoner/r1/thinking 需要代理去掉不支持的参数", () => {
  expect(isReasoningModel("deepseek-reasoner")).toBe(true);
  expect(isReasoningModel("DeepSeek-R1-0528")).toBe(true);
  expect(isReasoningModel("my-model-thinking")).toBe(true);
  expect(isReasoningModel("deepseek-chat")).toBe(false);
  expect(isReasoningModel("deepseek-chat-v3.2")).toBe(false);
});

test("AI 关闭时拆单/翻译直接回退 null（调用方走本地规则）", async () => {
  // 默认关闭时应在发出请求前直接返回本地规则器的回退信号。
  const parsed = await aiParseQuickOrder("更换刹车片 工时25000");
  expect(parsed).toBeNull();
  const translated = await aiTranslateRepair("更换刹车片");
  expect(translated).toBeNull();
});
