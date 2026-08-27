import { expect, test } from "@playwright/test";
import { aiParseInspectionNaturalLanguage } from "../../src/lib/ai/auto-repair";

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

test.beforeEach(() => {
  restoreAiBrowserStorage = installEnabledAiBrowserStorage();
});

test.afterEach(() => {
  restoreAiBrowserStorage?.();
  restoreAiBrowserStorage = undefined;
});

test("AI inspection success preserves explicit parts prices and closed fixed-total charges", async () => {
  const previousFetch = globalThis.fetch;
  let systemPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      messages: ReadonlyArray<{ role: string; content: string }>;
    };
    systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
    return new Response(JSON.stringify({
      content: JSON.stringify({
        items: [
          { findingZh: "检查刹车片", findingEn: "Inspect brake pads", recommendationZh: "更换刹车片", recommendationEn: "Replace brake pads", pricingMode: "unit", category: "parts", quantity: 3, amountJmd: 12_000, pendingQuote: true },
          { findingZh: "检查水泵", findingEn: "Inspect water pump", recommendationZh: "更换水泵", recommendationEn: "Replace water pump", pricingMode: "unit", category: "parts", amountJmd: 0, pendingQuote: true },
          { findingZh: "拖车费", findingEn: "Towing", recommendationZh: "拖车费", recommendationEn: "Towing", pricingMode: "fixed_total", category: "other_service", code: "towing", amountJmd: 7_500, pendingQuote: false },
        ],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await expect(aiParseInspectionNaturalLanguage("刹车片配件 12000\n水泵配件待报价\n拖车费 7500")).resolves.toEqual([
      expect.objectContaining({ pricingMode: "unit", category: "parts", quantity: 3, amountJmd: 12_000, pendingQuote: false }),
      expect.objectContaining({ pricingMode: "unit", category: "parts", amountJmd: 0, pendingQuote: true }),
      expect.objectContaining({ pricingMode: "fixed_total", category: "other_service", code: "towing", amountJmd: 7_500 }),
    ]);
    expect(systemPrompt).toContain("fixed_total");
    expect(systemPrompt).toContain("配件");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI inspection parser rejects the whole mixed response when one pricing discriminant is unknown", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: JSON.stringify({
      items: [
        { findingZh: "诊断", findingEn: "Diagnosis", recommendationZh: "诊断工时", recommendationEn: "Diagnostic labor", pricingMode: "unit", category: "labor", quantity: 1, amountJmd: 3_000, pendingQuote: false },
        { findingZh: "拖车费", findingEn: "Towing", recommendationZh: "拖车费", recommendationEn: "Towing", pricingMode: "fixed_totl", category: "other_service", code: "towing", amountJmd: 7_500, pendingQuote: false },
      ],
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await expect(aiParseInspectionNaturalLanguage("拖车费 7500")).resolves.toBeNull();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI inspection parser requires fixed-total amount to be an explicit safe integer", async () => {
  const previousFetch = globalThis.fetch;
  let malformedAmount: unknown = undefined;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: JSON.stringify({
      items: [
        { findingZh: "拖车费", findingEn: "Towing", recommendationZh: "拖车费", recommendationEn: "Towing", pricingMode: "fixed_total", category: "other_service", code: "towing", ...(malformedAmount === undefined ? {} : { amountJmd: malformedAmount }), pendingQuote: false },
      ],
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await expect(aiParseInspectionNaturalLanguage("拖车费 7500")).resolves.toBeNull();
    malformedAmount = "7500";
    await expect(aiParseInspectionNaturalLanguage("拖车费 7500")).resolves.toBeNull();
  } finally {
    globalThis.fetch = previousFetch;
  }
});
