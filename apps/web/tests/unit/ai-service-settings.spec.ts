import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getAiServiceSettings,
  getPublicAiServiceSettings,
  saveAiServiceSettings,
} from "../../src/lib/server/ai-service-settings";

async function isolatedSettings(run: (file: string) => Promise<void>) {
  await mkdir(path.join(process.cwd(), ".runtime"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".runtime", "ai-service-test-"));
  const previous = process.env.AI_SERVICE_SETTINGS_PATH;
  const previousVehicle = process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
  process.env.AI_SERVICE_SETTINGS_PATH = path.join(directory, "settings.json");
  delete process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
  try {
    await run(process.env.AI_SERVICE_SETTINGS_PATH);
  } finally {
    if (previous === undefined) delete process.env.AI_SERVICE_SETTINGS_PATH;
    else process.env.AI_SERVICE_SETTINGS_PATH = previous;
    if (previousVehicle === undefined) delete process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH;
    else process.env.VEHICLE_DOCUMENT_AI_SETTINGS_PATH = previousVehicle;
    await rm(directory, { recursive: true, force: true });
  }
}

test("AI service settings keep secrets server-side and retain keys on partial updates", async () => {
  await isolatedSettings(async (file) => {
    const publicSettings = await saveAiServiceSettings({
      providers: {
        deepseek: { enabled: true, apiKey: "deepseek-private-1234" },
        openai: { enabled: true, apiKey: "openai-private-5678" },
      },
    });
    expect(publicSettings.providers.deepseek).toMatchObject({ enabled: true, hasKey: true, keyMask: "••••1234" });
    expect(JSON.stringify(publicSettings)).not.toContain("private");

    await saveAiServiceSettings({ providers: { deepseek: { enabled: false } } });
    const stored = await getAiServiceSettings();
    expect(stored.providers.deepseek.apiKey).toBe("deepseek-private-1234");
    expect(stored.providers.openai.apiKey).toBe("openai-private-5678");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

test("version 1 vehicle settings migrate without losing the configured provider", async () => {
  await isolatedSettings(async (file) => {
    await writeFile(file, JSON.stringify({
      version: 1,
      provider: "openai",
      openAiModel: "gpt-4.1-mini",
      openAiApiKey: "legacy-openai-7788",
      googleApiKey: "legacy-google-9900",
      updatedAt: "2026-08-27T10:00:00.000Z",
    }));
    const migrated = await getAiServiceSettings();
    expect(migrated.providers.openai.apiKey).toBe("legacy-openai-7788");
    expect(migrated.providers.google.apiKey).toBe("legacy-google-9900");
    expect(migrated.routes.customer_license.steps[0]).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    expect(migrated.routes.vehicle_document.steps[0]).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
  });
});

test("task routes are normalized and unsafe compatible endpoints are rejected", async () => {
  await isolatedSettings(async () => {
    await expect(saveAiServiceSettings({
      providers: { compatible: { enabled: true, apiKey: "secret", baseUrl: "http://127.0.0.1:9999/v1" } },
    })).rejects.toThrow(/HTTPS/);

    const saved = await saveAiServiceSettings({
      providers: { compatible: { enabled: true, apiKey: "secret", baseUrl: "https://ai.example.com/v1" } },
      routes: {
        text: {
          enabled: true,
          autoFallback: true,
          steps: [
            { provider: "deepseek", model: "deepseek-chat" },
            { provider: "deepseek", model: "deepseek-chat" },
            { provider: "compatible", model: "repair-v2" },
          ],
        },
      },
    });
    expect(saved.routes.text.steps).toEqual([
      { provider: "deepseek", model: "deepseek-chat" },
      { provider: "compatible", model: "repair-v2" },
    ]);
    expect(JSON.parse(await readFile(process.env.AI_SERVICE_SETTINGS_PATH!, "utf8"))).toMatchObject({ version: 2 });
    expect(await getPublicAiServiceSettings()).toEqual(saved);
  });
});
