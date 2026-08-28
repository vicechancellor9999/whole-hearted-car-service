import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { AI_PROVIDER_IDS, getPublicAiServiceSettings, saveAiServiceSettings, type AiProviderId, type AiServiceSettingsUpdate } from "@/lib/server/ai-service-settings";
import { getRecentAiServiceEvents } from "@/lib/server/ai-service-events";
import { testAiProviderConnection } from "@/lib/server/ai-provider-connection";

export const runtime = "nodejs";

async function authorize(): Promise<Response | null> {
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (session.account.role !== "super_admin") return NextResponse.json({ error: "只有超级管理员可以维护 AI 服务" }, { status: 403 });
    return null;
  } catch {
    return NextResponse.json({ error: "登录服务暂时不可用" }, { status: 503 });
  }
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    return NextResponse.json({ ...(await getPublicAiServiceSettings()), recentEvents: await getRecentAiServiceEvents() });
  } catch {
    return NextResponse.json({ error: "读取 AI 设置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const body = await request.json() as AiServiceSettingsUpdate;
    return NextResponse.json(await saveAiServiceSettings(body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存 AI 设置失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => null) as { provider?: unknown; model?: unknown } | null;
    if (!AI_PROVIDER_IDS.includes(body?.provider as AiProviderId)) return NextResponse.json({ error: "请选择要测试的 AI 服务" }, { status: 400 });
    await testAiProviderConnection(body!.provider as AiProviderId, typeof body?.model === "string" ? body.model : undefined);
    return NextResponse.json({ ok: true, provider: body!.provider });
  } catch {
    return NextResponse.json({ error: "连接测试失败，请检查密钥、模型和服务状态" }, { status: 502 });
  }
}
