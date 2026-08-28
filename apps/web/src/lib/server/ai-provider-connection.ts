import { getAiServiceSettings, type AiProviderId } from "@/lib/server/ai-service-settings";

export async function testAiProviderConnection(providerId: AiProviderId, model?: string): Promise<void> {
  const settings = await getAiServiceSettings();
  const provider = settings.providers[providerId];
  if (!provider.enabled) throw new Error("这项 AI 服务已关闭");
  if (!provider.apiKey) throw new Error("请先填写 API Key");
  const selectedModel = model?.trim() || defaultModel(providerId);
  if (providerId === "google") return testGoogle(provider.apiKey);
  if (providerId === "openai") return testOpenAi(provider.apiKey, selectedModel);
  const baseUrl = providerId === "deepseek" ? "https://api.deepseek.com/v1" : provider.baseUrl;
  if (!baseUrl) throw new Error("请先填写兼容服务地址");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: selectedModel, messages: [{ role: "user", content: "Reply OK." }], max_tokens: 8 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`连接测试失败（${response.status}）`);
}

function defaultModel(provider: AiProviderId): string {
  if (provider === "deepseek") return "deepseek-chat";
  if (provider === "openai") return "gpt-4.1-mini";
  return "default";
}

async function testOpenAi(apiKey: string, model: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, store: false, input: "Reply OK.", max_output_tokens: 16 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`连接测试失败（${response.status}）`);
}

async function testGoogle(apiKey: string): Promise<void> {
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }, features: [{ type: "TEXT_DETECTION" }] }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`连接测试失败（${response.status}）`);
}
