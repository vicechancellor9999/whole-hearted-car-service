import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  getPublicVehicleDocumentAiSettings,
  getVehicleDocumentAiCredential,
  saveVehicleDocumentAiSettings,
} from "../../src/lib/server/vehicle-document-ai-settings";

test("vehicle document AI keys stay server-side and public settings only expose masks", async () => {
  await mkdir(path.join(process.cwd(), ".runtime"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".runtime", "vehicle-ai-test-"));
  const previousPath = process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousGoogle = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH = path.join(directory, "settings.json");
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_CLOUD_VISION_API_KEY;
  try {
    const publicSettings = await saveVehicleDocumentAiSettings({
      provider: "openai",
      openAiApiKey: "sk-test-secret-1234",
      openAiModel: "gpt-4.1-nano",
    });
    expect(publicSettings).toMatchObject({
      provider: "openai",
      openAiModel: "gpt-4.1-nano",
      hasOpenAiKey: true,
      hasGoogleKey: false,
      openAiKeyMask: "••••1234",
    });
    expect(JSON.stringify(publicSettings)).not.toContain("sk-test-secret");

    const credential = await getVehicleDocumentAiCredential();
    expect(credential).toEqual({ provider: "openai", apiKey: "sk-test-secret-1234", openAiModel: "gpt-4.1-nano" });
    expect(await getPublicVehicleDocumentAiSettings()).toEqual(publicSettings);
  } finally {
    if (previousPath === undefined) delete process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
    else process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH = previousPath;
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
    if (previousGoogle === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY;
    else process.env.GOOGLE_CLOUD_VISION_API_KEY = previousGoogle;
    await rm(directory, { recursive: true, force: true });
  }
});

test("saving one provider keeps the other provider key", async () => {
  await mkdir(path.join(process.cwd(), ".runtime"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".runtime", "vehicle-ai-test-"));
  const previousPath = process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
  process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH = path.join(directory, "settings.json");
  try {
    await saveVehicleDocumentAiSettings({ provider: "openai", openAiApiKey: "sk-openai-9999" });
    const updated = await saveVehicleDocumentAiSettings({ provider: "google", googleApiKey: "google-key-7777" });
    expect(updated).toMatchObject({
      provider: "google",
      hasOpenAiKey: true,
      hasGoogleKey: true,
      openAiKeyMask: "••••9999",
      googleKeyMask: "••••7777",
    });
  } finally {
    if (previousPath === undefined) delete process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
    else process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
