import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getRecentAiServiceEvents, recordAiServiceEvent } from "../../src/lib/server/ai-service-events";

test("AI service events persist only safe route metadata with private permissions", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".runtime", "ai-events-test-"));
  const file = path.join(directory, "events.jsonl");
  const previous = process.env.AI_SERVICE_EVENTS_PATH;
  process.env.AI_SERVICE_EVENTS_PATH = file;
  try {
    await recordAiServiceEvent({ timestamp: "2026-08-27T12:00:00.000Z", task: "text", provider: "deepseek", model: "deepseek-chat", outcome: "fallback", reason: "rate_limited" });
    expect(await getRecentAiServiceEvents()).toEqual([{ timestamp: "2026-08-27T12:00:00.000Z", task: "text", provider: "deepseek", model: "deepseek-chat", outcome: "fallback", reason: "rate_limited" }]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).not.toContain("apiKey");
  } finally {
    if (previous === undefined) delete process.env.AI_SERVICE_EVENTS_PATH;
    else process.env.AI_SERVICE_EVENTS_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
