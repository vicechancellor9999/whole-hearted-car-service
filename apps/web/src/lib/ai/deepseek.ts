import { loadAiSettings } from "./settings";

export interface DeepseekMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * DeepSeek 对话（经 Next.js 服务端代理转发，浏览器不直连）。
 * 失败一律抛错，由调用方回退到本地规则器。
 */
export async function deepseekChat(input: {
  messages: ReadonlyArray<DeepseekMessage>;
  json?: boolean;
}): Promise<string> {
  const settings = loadAiSettings();
  if (settings.provider !== "deepseek" || !settings.apiKey.trim()) {
    throw new Error("AI 服务未启用（系统设置里可关闭）");
  }
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: settings.apiKey,
      model: settings.model,
      messages: input.messages,
      json: input.json === true,
    }),
  });
  const payload = await response.json().catch(() => null) as { content?: string; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `AI 服务返回 ${response.status}`);
  const content = payload?.content?.trim() ?? "";
  if (!content) throw new Error("AI 返回为空");
  return content;
}

/** 连接测试：一个 token 的最小对话。 */
export async function testDeepseekConnection(): Promise<string> {
  return deepseekChat({
    messages: [
      { role: "user", content: "请只回复两个字：正常" },
    ],
  });
}
