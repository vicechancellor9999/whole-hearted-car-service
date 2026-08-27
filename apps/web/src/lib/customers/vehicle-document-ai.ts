import type { VehicleRecognitionResult } from "./vehicle-photo-recognition";

export type VehicleDocumentAiProvider = "openai" | "google";
export type OpenAiVehicleVisionModel = "gpt-4.1-nano" | "gpt-4.1-mini" | "gpt-4.1";

export async function recognizeVehicleDocumentWithAi(
  file: File,
  signal?: AbortSignal,
): Promise<VehicleRecognitionResult> {
  const body = new FormData();
  body.set("image", file);
  const response = await fetch("/api/ai/vehicle-document", { method: "POST", body, signal });
  const payload = await response.json().catch(() => null) as { fields?: VehicleRecognitionResult; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "车辆资料识别失败");
  return payload?.fields ?? {};
}
