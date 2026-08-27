/**
 * AI 服务设置（浏览器本地存储）。
 * 新浏览器默认关闭；只有用户明确保存非空 DeepSeek 设置后才启用。
 */

export const AI_SETTINGS_STORAGE_KEY = "wh_ai_settings_v1";

export const DEFAULT_DEEPSEEK_API_KEY = "";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

/** 设置页模型下拉的预设项；自定义项允许填任意模型名（代理原样转发）。 */
export const AI_MODEL_PRESETS = [
  { value: "deepseek-chat", label: "deepseek-chat（快速通用 · 翻译/拆单推荐）" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner（最强推理 · 慢、贵）" },
  { value: "custom", label: "自定义模型名…" },
] as const;

/** 推理模型：官方 API 不接受 temperature/max_tokens/response_format，且思考耗时远超 30s。 */
export function isReasoningModel(model: string): boolean {
  const name = model.trim().toLowerCase();
  return name.includes("reasoner") || name.includes("r1") || name.includes("-thinking");
}

export interface AiSettings {
  readonly provider: "off" | "deepseek";
  readonly apiKey: string;
  readonly model: string;
}

export function loadAiSettings(): AiSettings {
  if (typeof window === "undefined") {
    return { provider: "off", apiKey: DEFAULT_DEEPSEEK_API_KEY, model: DEFAULT_DEEPSEEK_MODEL };
  }
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { provider: "off", apiKey: DEFAULT_DEEPSEEK_API_KEY, model: DEFAULT_DEEPSEEK_MODEL };
    }
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      provider: parsed.provider === "deepseek" ? "deepseek" : "off",
      apiKey:
        typeof parsed.apiKey === "string" && parsed.apiKey.trim()
          ? parsed.apiKey
          : DEFAULT_DEEPSEEK_API_KEY,
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model
          : DEFAULT_DEEPSEEK_MODEL,
    };
  } catch {
    return { provider: "off", apiKey: DEFAULT_DEEPSEEK_API_KEY, model: DEFAULT_DEEPSEEK_MODEL };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function aiEnabled(): boolean {
  const settings = loadAiSettings();
  return settings.provider === "deepseek" && settings.apiKey.trim().length > 0;
}
