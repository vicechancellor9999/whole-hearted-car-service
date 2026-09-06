import { expect, test } from "@playwright/test";
import { aiParseFormalChargeEntry } from "../../src/lib/ai/auto-repair";

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

test("formal charge AI splits charge items and versioned notes in one response", async () => {
  const previousFetch = globalThis.fetch;
  let systemPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      messages: ReadonlyArray<{ role: string; content: string }>;
    };
    systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
    return new Response(JSON.stringify({
      content: JSON.stringify({
        items: [{
          descZh: "发动机保养",
          descEn: "Engine service",
          remarkZh: "更换三清件和机油",
          remarkEn: "Replace filters and engine oil",
          category: "labor",
          unit: "工时",
          unitPriceJmd: 8_000,
          quantity: 1,
          discountJmd: 0,
        }],
        notes: [{
          kind: "liability_notice",
          contentZh: "追加项目须再次确认",
          contentEn: "Additional work requires confirmation",
        }],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await expect(aiParseFormalChargeEntry("发动机保养 8000\n提前告知：追加项目须再次确认")).resolves.toEqual({
      items: [expect.objectContaining({
        descZh: "发动机保养",
        descEn: "Engine service",
        category: "labor",
        unitPriceJmd: 8_000,
      })],
      notes: [{
        kind: "liability_notice",
        contentZh: "追加项目须再次确认",
        contentEn: "Additional work requires confirmation",
      }],
    });
    expect(systemPrompt).toContain("客户反馈");
    expect(systemPrompt).toContain("施工说明");
    expect(systemPrompt).toContain("提前告知");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("formal charge AI rejects a partially invalid response so the UI can use the local fallback", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: JSON.stringify({
      items: [
        { descZh: "发动机保养", descEn: "Engine service", category: "labor", unitPriceJmd: 8_000, quantity: 1 },
        { descZh: "机油滤清器", descEn: "Oil filter", category: "unknown", unitPriceJmd: 5_000, quantity: 1 },
      ],
      notes: [],
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await expect(aiParseFormalChargeEntry("发动机保养 8000，机油滤清器 5000")).resolves.toBeNull();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

for (const category of ["labor", "parts"] as const) {
  test(`formal AI preserves missing ${category} pricing separately from explicit free pricing`, async () => {
    const previousFetch = globalThis.fetch;
    const base = { descZh: "检查项目", descEn: "Inspection item", category, quantity: 1, discountJmd: 0 };
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ items: [
      { ...base, unitPriceJmd: null, pendingQuote: true },
      { ...base, unitPriceJmd: 0, pendingQuote: false },
      { ...base, unitPriceJmd: 0 },
      { ...base, unitPriceJmd: 800, pendingQuote: false },
    ], notes: [] }) }), { status: 200 });
    try {
      const result = await aiParseFormalChargeEntry("人工核对价格的测试原文");
      expect(result?.items.map(item => [item.unitPriceJmd, item.pendingQuote])).toEqual([[0, true], [0, false], [0, true], [800, false]]);
    } finally { globalThis.fetch = previousFetch; }
  });
}

for (const quantity of [1.25, 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
  test(`formal AI rejects invalid whole quantity ${quantity} without rounding`, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ items: [
      { descZh: "清洗剂", descEn: "Cleaner", category: "parts", quantity, unitPriceJmd: 800, pendingQuote: false },
    ], notes: [] }) }), { status: 200 });
    try { expect(await aiParseFormalChargeEntry("清洗剂数量待核对")).toBeNull(); }
    finally { globalThis.fetch = previousFetch; }
  });
}

test("formal AI does not silently discard a nonzero price when the response also claims pending", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ items: [
    { descZh: "清洗剂", descEn: "Cleaner", category: "parts", quantity: 1, unitPriceJmd: 800, pendingQuote: true },
  ], notes: [] }) }), { status: 200 });
  try { expect(await aiParseFormalChargeEntry("清洗剂800")).toBeNull(); }
  finally { globalThis.fetch = previousFetch; }
});
