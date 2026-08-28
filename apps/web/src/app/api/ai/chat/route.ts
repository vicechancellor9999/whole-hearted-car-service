import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { isReasoningModel } from "@/lib/ai/settings";
import { executeAiTask, type AiAttemptContext } from "@/lib/server/ai-route-executor";
import { recordAiServiceEvent } from "@/lib/server/ai-service-events";

export const runtime = "nodejs";

type Message = { role: "system" | "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    if (!await currentSession()) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "登录服务暂时不可用" }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as { messages?: unknown; json?: unknown } | null;
  const messages = normalizeMessages(body?.messages);
  if (!messages.length) return NextResponse.json({ error: "对话内容不能为空" }, { status: 400 });
  const expectsJson = body?.json === true;
  try {
    const result = await executeAiTask({
      task: "text",
      attempt: (context) => requestChat(context, messages, expectsJson),
      assess: (content) => ({ acceptable: validContent(content, expectsJson), score: validContent(content, expectsJson) ? 1 : 0 }),
      recordEvent: recordAiServiceEvent,
    });
    return NextResponse.json({ content: result.value });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return NextResponse.json({ error: "请求已取消" }, { status: 499 });
    return NextResponse.json({ error: "AI 服务暂时不可用，系统将使用本地规则" }, { status: 502 });
  }
}

function validContent(content: string, expectsJson: boolean): boolean {
  if (!content.trim()) return false;
  if (!expectsJson) return true;
  try {
    const parsed = JSON.parse(content) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value) || value.length > 30) return [];
  const result: Message[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return [];
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim() || content.length > 30_000) return [];
    result.push({ role, content });
  }
  return result;
}

async function requestChat(context: AiAttemptContext, messages: Message[], json: boolean): Promise<string> {
  if (context.provider === "google") throw new Error("Google Vision does not support text chat");
  const baseUrl = context.provider === "deepseek"
    ? "https://api.deepseek.com/v1"
    : context.provider === "openai"
      ? "https://api.openai.com/v1"
      : context.baseUrl;
  if (!baseUrl) throw new Error("compatible endpoint missing");
  const reasoning = context.provider === "deepseek" && isReasoningModel(context.model);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.apiKey}` },
    body: JSON.stringify(reasoning
      ? { model: context.model, messages, max_tokens: 4_000 }
      : {
          model: context.model,
          messages,
          temperature: 0.2,
          max_tokens: 2_000,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
    signal: AbortSignal.timeout(reasoning ? 120_000 : 30_000),
  });
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
  if (!response.ok) throw Object.assign(new Error("upstream chat failed"), { status: response.status });
  return payload?.choices?.[0]?.message?.content?.trim() ?? "";
}
