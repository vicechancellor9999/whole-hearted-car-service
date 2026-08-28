import {
  getAiServiceSettings,
  getPublicAiServiceSettings,
  saveAiServiceSettings,
} from "@/lib/server/ai-service-settings";

export type VehicleDocumentAiProvider = "openai" | "google";
export type OpenAiVehicleVisionModel = "gpt-4.1-nano" | "gpt-4.1-mini" | "gpt-4.1";
export const DEFAULT_OPENAI_VEHICLE_VISION_MODEL: OpenAiVehicleVisionModel = "gpt-4.1-nano";

export type PublicVehicleDocumentAiSettings = {
  provider: VehicleDocumentAiProvider;
  openAiModel: OpenAiVehicleVisionModel;
  hasOpenAiKey: boolean;
  hasGoogleKey: boolean;
  openAiKeyMask: string | null;
  googleKeyMask: string | null;
  updatedAt: string | null;
};

function openAiModel(value: string): OpenAiVehicleVisionModel {
  return value === "gpt-4.1" || value === "gpt-4.1-mini" || value === "gpt-4.1-nano"
    ? value
    : DEFAULT_OPENAI_VEHICLE_VISION_MODEL;
}

export async function getPublicVehicleDocumentAiSettings(): Promise<PublicVehicleDocumentAiSettings> {
  const settings = await getPublicAiServiceSettings();
  const first = settings.routes.vehicle_document.steps.find((step) => step.provider === "openai" || step.provider === "google");
  const provider: VehicleDocumentAiProvider = first?.provider === "google" ? "google" : "openai";
  const modelStep = settings.routes.vehicle_document.steps.find((step) => step.provider === "openai");
  return {
    provider,
    openAiModel: openAiModel(modelStep?.model ?? DEFAULT_OPENAI_VEHICLE_VISION_MODEL),
    hasOpenAiKey: settings.providers.openai.hasKey,
    hasGoogleKey: settings.providers.google.hasKey,
    openAiKeyMask: settings.providers.openai.keyMask,
    googleKeyMask: settings.providers.google.keyMask,
    updatedAt: settings.updatedAt,
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
  const current = await getAiServiceSettings();
  const provider = input.provider === "google" ? "google" : "openai";
  const selectedModel = provider === "google" ? "document-text" : openAiModel(input.openAiModel ?? "gpt-4.1-nano");
  await saveAiServiceSettings({
    providers: {
      openai: { apiKey: input.openAiApiKey, clearApiKey: input.clearOpenAiKey },
      google: { apiKey: input.googleApiKey, clearApiKey: input.clearGoogleKey },
    },
    routes: {
      vehicle_document: {
        steps: [
          { provider, model: selectedModel },
          ...current.routes.vehicle_document.steps.filter((step) => step.provider !== provider),
        ],
      },
    },
  });
  const next = await getAiServiceSettings();
  if (!next.providers[provider].apiKey) throw new Error(`请先填写${provider === "openai" ? " OpenAI" : " Google"} API Key`);
  return getPublicVehicleDocumentAiSettings();
}

export async function getVehicleDocumentAiCredential(): Promise<{
  provider: VehicleDocumentAiProvider;
  apiKey: string;
  openAiModel: OpenAiVehicleVisionModel;
}> {
  const settings = await getAiServiceSettings();
  for (const step of settings.routes.vehicle_document.steps) {
    if (step.provider !== "openai" && step.provider !== "google") continue;
    const provider = settings.providers[step.provider];
    if (!provider.enabled || !provider.apiKey) continue;
    return { provider: step.provider, apiKey: provider.apiKey, openAiModel: openAiModel(step.model) };
  }
  throw new Error("尚未在系统设置中填写 OpenAI 或 Google API Key");
}

export async function testVehicleDocumentAiConnection(): Promise<{ provider: VehicleDocumentAiProvider }> {
  const credential = await getVehicleDocumentAiCredential();
  if (credential.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
      body: JSON.stringify({
        model: credential.openAiModel, store: false,
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
