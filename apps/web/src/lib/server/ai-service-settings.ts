import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const AI_PROVIDER_IDS = ["deepseek", "openai", "google", "compatible"] as const;
export const AI_TASK_IDS = ["text", "customer_license", "vehicle_document"] as const;

export type AiProviderId = typeof AI_PROVIDER_IDS[number];
export type AiTaskId = typeof AI_TASK_IDS[number];
export type AiRouteStep = { provider: AiProviderId; model: string };
export type AiTaskRoute = { enabled: boolean; autoFallback: boolean; steps: AiRouteStep[] };

type StoredProvider = {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
};

export type AiServiceSettings = {
  version: 2;
  providers: Record<AiProviderId, StoredProvider>;
  routes: Record<AiTaskId, AiTaskRoute>;
  updatedAt: string;
};

export type PublicAiServiceSettings = {
  version: 2;
  providers: Record<AiProviderId, {
    enabled: boolean;
    hasKey: boolean;
    keyMask: string | null;
    baseUrl: string | null;
  }>;
  routes: Record<AiTaskId, AiTaskRoute>;
  updatedAt: string | null;
};

type LegacySettings = {
  version: 1;
  provider?: unknown;
  openAiModel?: unknown;
  openAiApiKey?: unknown;
  googleApiKey?: unknown;
  updatedAt?: unknown;
};

export type AiServiceSettingsUpdate = {
  providers?: Partial<Record<AiProviderId, {
    enabled?: boolean;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl?: string;
  }>>;
  routes?: Partial<Record<AiTaskId, Partial<AiTaskRoute>>>;
};

const DEFAULT_ROUTES: Record<AiTaskId, AiTaskRoute> = {
  text: {
    enabled: true,
    autoFallback: true,
    steps: [
      { provider: "deepseek", model: "deepseek-chat" },
      { provider: "openai", model: "gpt-4.1-mini" },
      { provider: "compatible", model: "default" },
    ],
  },
  customer_license: {
    enabled: true,
    autoFallback: true,
    steps: [
      { provider: "openai", model: "gpt-4.1" },
      { provider: "google", model: "document-text" },
      { provider: "compatible", model: "default" },
    ],
  },
  vehicle_document: {
    enabled: true,
    autoFallback: true,
    steps: [
      { provider: "openai", model: "gpt-4.1-mini" },
      { provider: "google", model: "document-text" },
      { provider: "compatible", model: "default" },
    ],
  },
};

function settingsPath(): string {
  return process.env.AI_SERVICE_SETTINGS_PATH?.trim()
    || process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH?.trim()
    || path.join(process.cwd(), ".runtime", "vehicle-document-ai-settings.json");
}

function normalizeSecret(value: unknown, label: string): string | null {
  if (typeof value !== "string") return null;
  const secret = value.trim();
  if (!secret) return null;
  if (secret.length > 2_048 || /[\r\n]/.test(secret)) throw new Error(`${label} 格式无效`);
  return secret;
}

function normalizeModel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  if (!model || model.length > 160 || /[\r\n]/.test(model)) return fallback;
  return model;
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("自定义服务地址格式无效");
  }
  if (url.protocol !== "https:") throw new Error("自定义服务地址必须使用 HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("自定义服务地址不能包含凭据、查询参数或片段");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("自定义服务地址不能指向本机或私网");
  }
  return url.toString().replace(/\/$/, "");
}

function cloneRoute(route: AiTaskRoute): AiTaskRoute {
  return { ...route, steps: route.steps.map((step) => ({ ...step })) };
}

function defaults(): AiServiceSettings {
  return {
    version: 2,
    providers: {
      deepseek: { enabled: true, apiKey: normalizeSecret(process.env.DEEPSEEK_API_KEY, "DeepSeek API Key"), baseUrl: null },
      openai: { enabled: true, apiKey: normalizeSecret(process.env.OPENAI_API_KEY, "OpenAI API Key"), baseUrl: null },
      google: { enabled: true, apiKey: normalizeSecret(process.env.GOOGLE_CLOUD_VISION_API_KEY, "Google API Key"), baseUrl: null },
      compatible: { enabled: false, apiKey: null, baseUrl: null },
    },
    routes: {
      text: cloneRoute(DEFAULT_ROUTES.text),
      customer_license: cloneRoute(DEFAULT_ROUTES.customer_license),
      vehicle_document: cloneRoute(DEFAULT_ROUTES.vehicle_document),
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeSteps(value: unknown, fallback: AiRouteStep[]): AiRouteStep[] {
  if (!Array.isArray(value)) return fallback.map((step) => ({ ...step }));
  const seen = new Set<string>();
  const result: AiRouteStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const provider = (item as { provider?: unknown }).provider;
    if (!AI_PROVIDER_IDS.includes(provider as AiProviderId)) continue;
    const model = normalizeModel((item as { model?: unknown }).model, "default");
    const key = String(provider);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ provider: provider as AiProviderId, model });
    if (result.length === AI_PROVIDER_IDS.length) break;
  }
  return result.length ? result : fallback.map((step) => ({ ...step }));
}

function normalizeV2(parsed: Partial<AiServiceSettings>): AiServiceSettings {
  const base = defaults();
  const providers = parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {};
  for (const id of AI_PROVIDER_IDS) {
    const item = (providers as Partial<Record<AiProviderId, Partial<StoredProvider>>>)[id];
    if (!item) continue;
    base.providers[id] = {
      enabled: typeof item.enabled === "boolean" ? item.enabled : base.providers[id].enabled,
      apiKey: normalizeSecret(item.apiKey, `${id} API Key`) ?? base.providers[id].apiKey,
      baseUrl: id === "compatible" ? normalizeBaseUrl(item.baseUrl) : null,
    };
  }
  const routes = parsed.routes && typeof parsed.routes === "object" ? parsed.routes : {};
  for (const id of AI_TASK_IDS) {
    const item = (routes as Partial<Record<AiTaskId, Partial<AiTaskRoute>>>)[id];
    if (!item) continue;
    base.routes[id] = {
      enabled: typeof item.enabled === "boolean" ? item.enabled : base.routes[id].enabled,
      autoFallback: typeof item.autoFallback === "boolean" ? item.autoFallback : base.routes[id].autoFallback,
      steps: normalizeSteps(item.steps, base.routes[id].steps),
    };
  }
  base.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : base.updatedAt;
  return base;
}

function migrateLegacy(parsed: LegacySettings): AiServiceSettings {
  const base = defaults();
  base.providers.openai.apiKey = normalizeSecret(parsed.openAiApiKey, "OpenAI API Key") ?? base.providers.openai.apiKey;
  base.providers.google.apiKey = normalizeSecret(parsed.googleApiKey, "Google API Key") ?? base.providers.google.apiKey;
  const provider: AiProviderId = parsed.provider === "google" ? "google" : "openai";
  const model = provider === "openai" ? normalizeModel(parsed.openAiModel, "gpt-4.1-nano") : "document-text";
  for (const task of ["customer_license", "vehicle_document"] as const) {
    base.routes[task].steps = [
      { provider, model },
      ...base.routes[task].steps.filter((step) => step.provider !== provider),
    ];
  }
  base.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : base.updatedAt;
  return base;
}

export async function getAiServiceSettings(): Promise<AiServiceSettings> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ settingsPath(), "utf8")) as Partial<AiServiceSettings> | LegacySettings;
    return parsed.version === 1 ? migrateLegacy(parsed as LegacySettings) : normalizeV2(parsed as Partial<AiServiceSettings>);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return defaults();
    throw error;
  }
}

function toPublic(settings: AiServiceSettings): PublicAiServiceSettings {
  const providers = {} as PublicAiServiceSettings["providers"];
  for (const id of AI_PROVIDER_IDS) {
    const provider = settings.providers[id];
    providers[id] = {
      enabled: provider.enabled,
      hasKey: Boolean(provider.apiKey),
      keyMask: provider.apiKey ? `••••${provider.apiKey.slice(-4)}` : null,
      baseUrl: provider.baseUrl,
    };
  }
  return {
    version: 2,
    providers,
    routes: {
      text: cloneRoute(settings.routes.text),
      customer_license: cloneRoute(settings.routes.customer_license),
      vehicle_document: cloneRoute(settings.routes.vehicle_document),
    },
    updatedAt: settings.updatedAt === new Date(0).toISOString() ? null : settings.updatedAt,
  };
}

export async function getPublicAiServiceSettings(): Promise<PublicAiServiceSettings> {
  return toPublic(await getAiServiceSettings());
}

export async function saveAiServiceSettings(input: AiServiceSettingsUpdate): Promise<PublicAiServiceSettings> {
  const previous = await getAiServiceSettings();
  for (const id of AI_PROVIDER_IDS) {
    const update = input.providers?.[id];
    if (!update) continue;
    const replacement = normalizeSecret(update.apiKey, `${id} API Key`);
    previous.providers[id] = {
      enabled: typeof update.enabled === "boolean" ? update.enabled : previous.providers[id].enabled,
      apiKey: update.clearApiKey ? null : replacement ?? previous.providers[id].apiKey,
      baseUrl: id === "compatible"
        ? (update.baseUrl === undefined ? previous.providers[id].baseUrl : normalizeBaseUrl(update.baseUrl))
        : null,
    };
  }
  for (const id of AI_TASK_IDS) {
    const update = input.routes?.[id];
    if (!update) continue;
    previous.routes[id] = {
      enabled: typeof update.enabled === "boolean" ? update.enabled : previous.routes[id].enabled,
      autoFallback: typeof update.autoFallback === "boolean" ? update.autoFallback : previous.routes[id].autoFallback,
      steps: normalizeSteps(update.steps, previous.routes[id].steps),
    };
  }
  previous.updatedAt = new Date().toISOString();
  const destination = settingsPath();
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(previous, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return toPublic(previous);
}
