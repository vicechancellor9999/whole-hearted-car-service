import { expect, test } from "@playwright/test";
import { aiClassifyFormalBusinessOrder } from "../../src/lib/ai/auto-repair";

function installEnabledAiBrowserStorage(): () => void {
  const values = new Map<string, string>([[
    "wh_ai_settings_v1",
    JSON.stringify({ provider: "deepseek", apiKey: "unit-test-only", model: "deepseek-chat" }),
  ]]);
  const storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  return () => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

let restoreAiBrowserStorage: (() => void) | undefined;

test.beforeEach(() => { restoreAiBrowserStorage = installEnabledAiBrowserStorage(); });
test.afterEach(() => { restoreAiBrowserStorage?.(); restoreAiBrowserStorage = undefined; });

test("AI business-order classification accepts and de-duplicates multiple categories", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: JSON.stringify({ categories: ["inspection", "maintenance", "inspection", "repair"] }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await expect(aiClassifyFormalBusinessOrder("检查异响并做保养，必要时维修"))
      .resolves.toEqual(["maintenance", "repair", "inspection"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI business-order classification rejects unknown categories", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: JSON.stringify({ categories: ["maintenance", "bodywork"] }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await expect(aiClassifyFormalBusinessOrder("保养和钣金"))
      .resolves.toBeNull();
  } finally {
    globalThis.fetch = previousFetch;
  }
});
