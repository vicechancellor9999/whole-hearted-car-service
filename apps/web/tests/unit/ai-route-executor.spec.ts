import { expect, test } from "@playwright/test";
import { executeAiTask, type AiAttemptContext } from "../../src/lib/server/ai-route-executor";
import type { AiServiceSettings } from "../../src/lib/server/ai-service-settings";

function settings(): AiServiceSettings {
  return {
    version: 2,
    providers: {
      deepseek: { enabled: true, apiKey: "deepseek-secret", baseUrl: null },
      openai: { enabled: true, apiKey: "openai-secret", baseUrl: null },
      google: { enabled: true, apiKey: "google-secret", baseUrl: null },
      compatible: { enabled: false, apiKey: null, baseUrl: null },
    },
    routes: {
      text: { enabled: true, autoFallback: true, steps: [
        { provider: "deepseek", model: "deepseek-chat" },
        { provider: "openai", model: "gpt-4.1-mini" },
      ] },
      customer_license: { enabled: true, autoFallback: true, steps: [] },
      vehicle_document: { enabled: true, autoFallback: true, steps: [] },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

test("AI route falls back in order and never exposes keys in events", async () => {
  const attempts: AiAttemptContext[] = [];
  const events: unknown[] = [];
  const result = await executeAiTask({
    task: "text",
    settings: settings(),
    attempt: async (context) => {
      attempts.push(context);
      if (context.provider === "deepseek") throw Object.assign(new Error("quota secret payload"), { status: 429 });
      return "repaired";
    },
    recordEvent: async (event) => { events.push(event); },
  });
  expect(attempts.map(({ provider }) => provider)).toEqual(["deepseek", "openai"]);
  expect(result).toMatchObject({ value: "repaired", provider: "openai", model: "gpt-4.1-mini", fallbackUsed: true });
  expect(JSON.stringify(events)).not.toContain("secret");
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ task: "text", provider: "deepseek", outcome: "fallback", reason: "rate_limited" })]));
});

test("AI route continues after an incomplete result and returns the best partial candidate", async () => {
  const configured = settings();
  configured.routes.customer_license.steps = [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "google", model: "document-text" },
  ];
  const result = await executeAiTask({
    task: "customer_license",
    settings: configured,
    attempt: async ({ provider }) => provider === "openai" ? { fields: 2 } : { fields: 1 },
    assess: (value) => ({ acceptable: value.fields === 4, score: value.fields }),
  });
  expect(result).toMatchObject({ value: { fields: 2 }, provider: "openai", fallbackUsed: false, partial: true });
});

test("AI route does not retry a user cancellation", async () => {
  let calls = 0;
  await expect(executeAiTask({
    task: "text",
    settings: settings(),
    attempt: async () => {
      calls += 1;
      throw new DOMException("cancelled", "AbortError");
    },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});
