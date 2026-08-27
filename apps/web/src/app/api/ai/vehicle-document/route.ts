import { NextResponse } from "next/server";
import { parseVehicleDocumentText } from "@/lib/customers/vehicle-photo-recognition";
import { sanitizeOpenAiVehicleFields } from "@/lib/customers/openai-vehicle-document";
import { getVehicleDocumentAiCredential } from "@/lib/server/vehicle-document-ai-settings";
import {
  prepareVehicleDocumentImage,
  VEHICLE_DOCUMENT_RECOGNITION_PROMPT,
} from "@/lib/server/vehicle-document-image";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

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
      const text = part && typeof part === "object" ? (part as { text?: unknown }).text : null;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return "";
}

async function recognizeWithOpenAi(imageBase64: string, mimeType: string, apiKey: string, model: string) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: VEHICLE_DOCUMENT_RECOGNITION_PROMPT },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}`, detail: "high" },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "vehicle_registration",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(["plate", "vin", "engineNumber", "make", "model", "year", "color", "bodyType", "seating", "ccRating", "fuelType"].map((field) => [field, { type: ["string", "null"] }])),
            required: ["plate", "vin", "engineNumber", "make", "model", "year", "color", "bodyType", "seating", "ccRating", "fuelType"],
          },
        },
      },
      max_output_tokens: 320,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await upstream.json().catch(() => null) as unknown;
  if (!upstream.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { message?: string } }).error?.message
      : null;
    throw new Error(message || `OpenAI 返回 ${upstream.status}`);
  }
  const content = responseText(payload);
  if (!content) throw new Error("OpenAI 没有返回识别内容");
  return sanitizeOpenAiVehicleFields(JSON.parse(content));
}

async function recognizeWithGoogle(imageBase64: string, apiKey: string) {
  const upstream = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: imageBase64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await upstream.json().catch(() => null) as { responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>; error?: { message?: string } } | null;
  if (!upstream.ok) throw new Error(payload?.error?.message || `Google 返回 ${upstream.status}`);
  const result = payload?.responses?.[0];
  if (result?.error?.message) throw new Error(result.error.message);
  const text = result?.fullTextAnnotation?.text?.trim() ?? "";
  if (!text) throw new Error("Google 没有识别出文字");
  return parseVehicleDocumentText(text);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return NextResponse.json({ error: "请选择车辆资料图片" }, { status: 400 });
    if (!IMAGE_TYPES.has(image.type)) return NextResponse.json({ error: "仅支持 JPEG 或 PNG 图片" }, { status: 400 });
    if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "图片必须小于 12 MB" }, { status: 400 });
    const { provider, apiKey, openAiModel } = await getVehicleDocumentAiCredential();
    const prepared = await prepareVehicleDocumentImage(Buffer.from(await image.arrayBuffer()), image.type);
    const imageBase64 = prepared.buffer.toString("base64");
    const fields = provider === "openai"
      ? await recognizeWithOpenAi(imageBase64, prepared.mimeType, apiKey, openAiModel)
      : await recognizeWithGoogle(imageBase64, apiKey);
    return NextResponse.json({ provider, fields });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "车辆资料识别失败" }, { status: 502 });
  }
}
