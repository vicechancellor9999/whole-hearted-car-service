import { NextResponse } from "next/server";
import { isReasoningModel } from "@/lib/ai/settings";

export const runtime = "nodejs";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

/**
 * DeepSeek 服务端代理（老板 2026-08-18 要求接入）：
 * 浏览器把密钥连同消息发到这里，服务端转发，浏览器不直连 DeepSeek。
 * 原型阶段密钥存浏览器 localStorage；正式系统密钥只允许放服务端环境变量。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    apiKey?: string; model?: string; messages?: Array<{ role: string; content: string }>; json?: boolean;
  } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!apiKey) return NextResponse.json({ error: "未配置 DeepSeek 密钥" }, { status: 400 });
  if (messages.length === 0) return NextResponse.json({ error: "对话内容不能为空" }, { status: 400 });

  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "deepseek-chat";
  // 推理模型（deepseek-reasoner）不接受 temperature/max_tokens/response_format，且思考耗时长：
  // 代理按模型自动适配参数与超时，老板在设置里切到最强模型即可用。
  const reasoning = isReasoningModel(model);
  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(reasoning
        ? { model, messages, max_tokens: 4_000 }
        : {
            model,
            messages,
            temperature: 0.2,
            max_tokens: 2_000,
            ...(body?.json === true ? { response_format: { type: "json_object" } } : {}),
          }),
      signal: AbortSignal.timeout(reasoning ? 120_000 : 30_000),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 服务不可达" }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  if (!upstream.ok) {
    return NextResponse.json({ error: payload?.error?.message ?? `DeepSeek ${upstream.status}` }, { status: 502 });
  }
  const content = payload?.choices?.[0]?.message?.content ?? "";
  return NextResponse.json({ content });
}
