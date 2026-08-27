import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type VehicleDocumentAiProvider = "openai" | "google";
export type OpenAiVehicleVisionModel = "gpt-4.1-nano" | "gpt-4.1-mini" | "gpt-4.1";

export const DEFAULT_OPENAI_VEHICLE_VISION_MODEL: OpenAiVehicleVisionModel = "gpt-4.1-nano";

type StoredVehicleDocumentAiSettings = {
  version: 1;
  provider: VehicleDocumentAiProvider;
  openAiModel: OpenAiVehicleVisionModel;
  openAiApiKey: string | null;
  googleApiKey: string | null;
  updatedAt: string;
};

export type PublicVehicleDocumentAiSettings = {
  provider: VehicleDocumentAiProvider;
  openAiModel: OpenAiVehicleVisionModel;
  hasOpenAiKey: boolean;
  hasGoogleKey: boolean;
  openAiKeyMask: string | null;
  googleKeyMask: string | null;
  updatedAt: string | null;
};

const SETTINGS_FILE_NAME = "vehicle-document-ai-settings.json";

function settingsPath(): string {
  const configured = process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH?.trim();
  return configured || path.join(process.cwd(), ".runtime", SETTINGS_FILE_NAME);
}

function normalizeProvider(value: unknown): VehicleDocumentAiProvider {
  return value === "google" ? "google" : "openai";
}

function normalizeOpenAiModel(value: unknown): OpenAiVehicleVisionModel {
  return value === "gpt-4.1" || value === "gpt-4.1-mini" || value === "gpt-4.1-nano"
    ? value
    : DEFAULT_OPENAI_VEHICLE_VISION_MODEL;
}

function normalizeSecret(value: unknown, label: string): string | null {
  if (typeof value !== "string") return null;
  const secret = value.trim();
  if (!secret) return null;
  if (secret.length > 2_048 || /[\r\n]/.test(secret)) throw new Error(`${label} 格式无效`);
  return secret;
}

function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  const tail = secret.slice(-4);
  return `••••${tail}`;
}

async function readStoredSettings(): Promise<StoredVehicleDocumentAiSettings | null> {
  try {
    const parsed = JSON.parse(await readFile(
      /* turbopackIgnore: true */ settingsPath(),
      "utf8",
    )) as Partial<StoredVehicleDocumentAiSettings>;
    if (parsed.version !== 1) return null;
    return {
      version: 1,
      provider: normalizeProvider(parsed.provider),
      openAiModel: normalizeOpenAiModel(parsed.openAiModel),
      openAiApiKey: normalizeSecret(parsed.openAiApiKey, "OpenAI API Key"),
      googleApiKey: normalizeSecret(parsed.googleApiKey, "Google API Key"),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function environmentSecrets() {
  return {
    openAiApiKey: normalizeSecret(process.env.OPENAI_API_KEY, "OpenAI API Key"),
    googleApiKey: normalizeSecret(process.env.GOOGLE_CLOUD_VISION_API_KEY, "Google API Key"),
  };
}

export async function getPublicVehicleDocumentAiSettings(): Promise<PublicVehicleDocumentAiSettings> {
  const stored = await readStoredSettings();
  const environment = environmentSecrets();
  const openAiApiKey = stored?.openAiApiKey ?? environment.openAiApiKey;
  const googleApiKey = stored?.googleApiKey ?? environment.googleApiKey;
  return {
    provider: stored?.provider ?? normalizeProvider(process.env.VEHICLE_DOCUMENT_AI_PROVIDER),
    openAiModel: stored?.openAiModel ?? normalizeOpenAiModel(process.env.OPENAI_VEHICLE_VISION_MODEL),
    hasOpenAiKey: Boolean(openAiApiKey),
    hasGoogleKey: Boolean(googleApiKey),
    openAiKeyMask: maskSecret(openAiApiKey),
    googleKeyMask: maskSecret(googleApiKey),
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function saveVehicleDocumentAiSettings(input: {
  provider: VehicleDocumentAiProvider;
  openAiModel?: OpenAiVehicleVisionModel;
  openAiApiKey?: string;
  googleApiKey?: string;
  clearOpenAiKey?: boolean;
  clearGoogleKey?: boolean;
}): Promise<PublicVehicleDocumentAiSettings> {
  const previous = await readStoredSettings();
  const environment = environmentSecrets();
  const openAiReplacement = normalizeSecret(input.openAiApiKey, "OpenAI API Key");
  const googleReplacement = normalizeSecret(input.googleApiKey, "Google API Key");
  const provider = normalizeProvider(input.provider);
  const next: StoredVehicleDocumentAiSettings = {
    version: 1,
    provider,
    openAiModel: normalizeOpenAiModel(input.openAiModel ?? previous?.openAiModel ?? process.env.OPENAI_VEHICLE_VISION_MODEL),
    openAiApiKey: input.clearOpenAiKey
      ? null
      : openAiReplacement ?? previous?.openAiApiKey ?? environment.openAiApiKey,
    googleApiKey: input.clearGoogleKey
      ? null
      : googleReplacement ?? previous?.googleApiKey ?? environment.googleApiKey,
    updatedAt: new Date().toISOString(),
  };
  const activeKey = provider === "openai" ? next.openAiApiKey : next.googleApiKey;
  if (!activeKey) throw new Error(`请先填写${provider === "openai" ? " OpenAI" : " Google"} API Key`);

  const destination = settingsPath();
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return getPublicVehicleDocumentAiSettings();
}

export async function getVehicleDocumentAiCredential(): Promise<{
  provider: VehicleDocumentAiProvider;
  apiKey: string;
  openAiModel: OpenAiVehicleVisionModel;
}> {
  const stored = await readStoredSettings();
  const environment = environmentSecrets();
  const provider = stored?.provider ?? normalizeProvider(process.env.VEHICLE_DOCUMENT_AI_PROVIDER);
  const apiKey = provider === "openai"
    ? stored?.openAiApiKey ?? environment.openAiApiKey
    : stored?.googleApiKey ?? environment.googleApiKey;
  if (!apiKey) throw new Error(`尚未在系统设置中填写${provider === "openai" ? " OpenAI" : " Google"} API Key`);
  const openAiModel = stored?.openAiModel ?? normalizeOpenAiModel(process.env.OPENAI_VEHICLE_VISION_MODEL);
  return { provider, apiKey, openAiModel };
}

export async function testVehicleDocumentAiConnection(): Promise<{ provider: VehicleDocumentAiProvider }> {
  const credential = await getVehicleDocumentAiCredential();
  if (credential.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
      body: JSON.stringify({
        model: credential.openAiModel,
        store: false,
        input: [{ role: "user", content: [{ type: "input_text", text: "Reply OK." }] }],
        max_output_tokens: 16,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message || `OpenAI 连接失败（${response.status}）`);
    }
    return { provider: credential.provider };
  }

  const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(credential.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: onePixelPng }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }] }] }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; responses?: Array<{ error?: { message?: string } }> } | null;
  const message = payload?.error?.message ?? payload?.responses?.[0]?.error?.message;
  if (!response.ok || message) throw new Error(message || `Google 连接失败（${response.status}）`);
  return { provider: credential.provider };
}
