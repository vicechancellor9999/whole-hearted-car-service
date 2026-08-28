import {
  recognitionFromFields,
  type CustomerLicenseRecognition,
} from "@/lib/customers/customer-driver-license-recognition";
import type { PreparedCustomerDriverLicenseImage } from "@/lib/server/customer-driver-license-image";
import { executeAiTask, type AiAttemptContext } from "@/lib/server/ai-route-executor";
import type { AiRouteEvent } from "@/lib/server/ai-route-executor";
import { recordAiServiceEvent } from "@/lib/server/ai-service-events";
import type { AiServiceSettings } from "@/lib/server/ai-service-settings";
import {
  type OpenAiVehicleVisionModel,
  type VehicleDocumentAiProvider,
} from "@/lib/server/vehicle-document-ai-settings";

const CUSTOMER_LICENSE_PROMPT = [
  "Read the front of this Jamaican driver's license.",
  "Return only characters visibly present and never guess missing content.",
  "Extract exactly four fields: full printed name, date of birth as YYYY-MM-DD, sex as M or F, and the printed license address.",
  "Use null for every field that is absent, unclear, incomplete, or outside the image.",
].join(" ");

type Credential = {
  provider: VehicleDocumentAiProvider;
  apiKey: string;
  openAiModel: OpenAiVehicleVisionModel;
};

export async function recognizeCustomerDriverLicense(
  image: PreparedCustomerDriverLicenseImage,
  options: {
    credential?: Credential;
    fetcher?: typeof fetch;
    now?: Date;
    signal?: AbortSignal;
    settings?: AiServiceSettings;
    recordEvent?: (event: AiRouteEvent) => Promise<void>;
  } = {},
): Promise<CustomerLicenseRecognition> {
  const fetcher = options.fetcher ?? fetch;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  if (options.credential) {
    const fields = options.credential.provider === "openai"
      ? await recognizeWithOpenAi(image, options.credential, fetcher, signal)
      : await recognizeWithGoogle(image, options.credential, fetcher, signal);
    return recognitionFromFields(fields, options.now);
  }
  const routed = await executeAiTask({
    task: "customer_license",
    attempt: async (context) => recognitionFromFields(
      await recognizeWithContext(image, context, fetcher, signal),
      options.now,
    ),
    assess: (value) => {
      const score = Object.values(value.status).filter((status) => status === "extracted").length;
      return { acceptable: score === 4, score };
    },
    settings: options.settings,
    recordEvent: options.recordEvent ?? recordAiServiceEvent,
  });
  return routed.value;
}

async function recognizeWithContext(
  image: PreparedCustomerDriverLicenseImage,
  context: AiAttemptContext,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (context.provider === "google") {
    return recognizeWithGoogle(image, { provider: "google", apiKey: context.apiKey, openAiModel: "gpt-4.1-nano" }, fetcher, signal);
  }
  if (context.provider === "openai") {
    return recognizeWithOpenAi(image, { provider: "openai", apiKey: context.apiKey, openAiModel: openAiModel(context.model) }, fetcher, signal);
  }
  if (context.provider === "compatible" && context.baseUrl) {
    return recognizeWithOpenAi(
      image,
      { provider: "openai", apiKey: context.apiKey, openAiModel: openAiModel(context.model) },
      fetcher,
      signal,
      `${context.baseUrl}/responses`,
      context.model,
    );
  }
  throw new Error("provider does not support customer license vision");
}

function openAiModel(model: string): OpenAiVehicleVisionModel {
  return model === "gpt-4.1" || model === "gpt-4.1-mini" || model === "gpt-4.1-nano" ? model : "gpt-4.1";
}

export function parseJamaicaDriverLicenseText(text: string): Record<string, unknown> {
  const lines = text.normalize("NFKC").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let name: string | null = null;
  let birthDate: string | null = null;
  let sex: string | null = null;
  let address: string | null = null;
  for (const line of lines) {
    const nameMatch = line.match(/^(?:FULL\s+)?NAME\s*[:#-]\s*(.+)$/i);
    if (!name && nameMatch) name = nameMatch[1].trim();
    const birthMatch = line.match(/^(?:DATE\s+OF\s+BIRTH|D\.?O\.?B\.?)\s*[:#-]\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/i);
    if (!birthDate && birthMatch) {
      birthDate = `${birthMatch[3]}-${birthMatch[2].padStart(2, "0")}-${birthMatch[1].padStart(2, "0")}`;
    }
    const sexMatch = line.match(/^SEX\s*[:#-]\s*([MF])$/i);
    if (!sex && sexMatch) sex = sexMatch[1].toUpperCase();
    const addressMatch = line.match(/^ADDRESS\s*[:#-]\s*(.+)$/i);
    if (!address && addressMatch) address = addressMatch[1].trim();
  }
  return { name, birthDate, sex, address };
}

async function recognizeWithOpenAi(
  image: PreparedCustomerDriverLicenseImage,
  credential: Credential,
  fetcher: typeof fetch,
  signal: AbortSignal,
  endpoint = "https://api.openai.com/v1/responses",
  modelOverride?: string,
): Promise<Record<string, unknown>> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
    body: JSON.stringify({
      model: modelOverride ?? credential.openAiModel,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: CUSTOMER_LICENSE_PROMPT },
          {
            type: "input_image",
            image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
            detail: "high",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "jamaica_driver_license_front",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: ["string", "null"] },
              birthDate: { type: ["string", "null"] },
              sex: { type: ["string", "null"] },
              address: { type: ["string", "null"] },
            },
            required: ["name", "birthDate", "sex", "address"],
          },
        },
      },
      max_output_tokens: 240,
    }),
    signal,
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw Object.assign(new Error("customer license OpenAI request failed"), { status: response.status });
  const content = responseText(payload);
  if (!content) throw new Error("customer license OpenAI response missing");
  return exactProviderFields(JSON.parse(content));
}

async function recognizeWithGoogle(
  image: PreparedCustomerDriverLicenseImage,
  credential: Credential,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetcher(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(credential.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: image.buffer.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
      signal,
    },
  );
  const payload = await response.json().catch(() => null) as {
    responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: unknown }>;
    error?: unknown;
  } | null;
  if (!response.ok || payload?.error || payload?.responses?.[0]?.error) {
    throw Object.assign(new Error("customer license Google request failed"), { status: response.status });
  }
  const text = payload?.responses?.[0]?.fullTextAnnotation?.text;
  return parseJamaicaDriverLicenseText(typeof text === "string" ? text : "");
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as { output_text?: unknown; output?: unknown };
  if (typeof root.output_text === "string") return root.output_text;
  if (!Array.isArray(root.output)) return "";
  for (const item of root.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function exactProviderFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("customer license provider response invalid");
  }
  const keys = Object.keys(value).sort();
  const expected = ["address", "birthDate", "name", "sex"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("customer license provider response invalid");
  }
  return value as Record<string, unknown>;
}
