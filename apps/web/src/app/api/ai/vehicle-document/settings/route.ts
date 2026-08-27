import { NextResponse } from "next/server";
import {
  getPublicVehicleDocumentAiSettings,
  saveVehicleDocumentAiSettings,
  testVehicleDocumentAiConnection,
  type VehicleDocumentAiProvider,
  type OpenAiVehicleVisionModel,
} from "@/lib/server/vehicle-document-ai-settings";

export const runtime = "nodejs";

const FORMAL_BACKEND_ORIGIN = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";

async function requireSuperAdministrator(request: Request): Promise<Response | null> {
  try {
    const response = await fetch(`${FORMAL_BACKEND_ORIGIN}/api/auth/session`, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
        "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const payload = await response.json() as { account?: { role?: string } };
    if (payload.account?.role !== "super_admin") {
      return NextResponse.json({ error: "只有超级管理员可以维护识别服务" }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: "登录服务暂时不可用" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const denied = await requireSuperAdministrator(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getPublicVehicleDocumentAiSettings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取识别设置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireSuperAdministrator(request);
  if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.provider !== "openai" && body.provider !== "google") {
      return NextResponse.json({ error: "请选择 OpenAI 或 Google" }, { status: 400 });
    }
    const settings = await saveVehicleDocumentAiSettings({
      provider: body.provider as VehicleDocumentAiProvider,
      ...(body.openAiModel === "gpt-4.1-nano" || body.openAiModel === "gpt-4.1-mini" || body.openAiModel === "gpt-4.1"
        ? { openAiModel: body.openAiModel as OpenAiVehicleVisionModel }
        : {}),
      ...(typeof body.openAiApiKey === "string" ? { openAiApiKey: body.openAiApiKey } : {}),
      ...(typeof body.googleApiKey === "string" ? { googleApiKey: body.googleApiKey } : {}),
      clearOpenAiKey: body.clearOpenAiKey === true,
      clearGoogleKey: body.clearGoogleKey === true,
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存识别设置失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const denied = await requireSuperAdministrator(request);
  if (denied) return denied;
  try {
    const result = await testVehicleDocumentAiConnection();
    return NextResponse.json({ ok: true, provider: result.provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "连接测试失败" }, { status: 502 });
  }
}
