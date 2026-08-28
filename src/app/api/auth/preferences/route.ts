import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRequestId } from "@formal/lib/request-id";
import { createAuthRuntime } from "@formal/modules/auth/auth-runtime";
import type {
  AccountUiLanguage,
  AuthRequestContext,
  CurrentSession,
} from "@formal/modules/auth/auth-service";

type PreferencesApiDependencies = {
  rawToken: string | null;
  readSession(rawToken: string): Promise<CurrentSession | null>;
  updateUiLanguage(input: {
    accountId: number;
    uiLanguage: AccountUiLanguage;
    context: AuthRequestContext;
  }): Promise<AccountUiLanguage>;
};

export function createPreferencesApiHandler(dependencies: PreferencesApiDependencies) {
  return async function preferencesApiHandler(request: Request): Promise<Response> {
    if (!dependencies.rawToken) {
      return NextResponse.json({ code: "unauthorized" }, { status: 401 });
    }
    const session = await dependencies.readSession(dependencies.rawToken);
    if (!session) {
      return NextResponse.json({ code: "unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => null) as unknown;
    if (!isPreferenceBody(body)) {
      return NextResponse.json({ code: "invalid_ui_language" }, { status: 400 });
    }
    const uiLanguage = await dependencies.updateUiLanguage({
      accountId: session.account.id,
      uiLanguage: body.uiLanguage,
      context: {
        requestId: request.headers.get("x-request-id") ?? createRequestId(),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json({ uiLanguage });
  };
}

function isPreferenceBody(value: unknown): value is { uiLanguage: AccountUiLanguage } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1
    && (record.uiLanguage === "zh" || record.uiLanguage === "en");
}

export async function PATCH(request: Request): Promise<Response> {
  const runtime = createAuthRuntime(process.env);
  const rawToken = (await cookies()).get(runtime.env.SESSION_COOKIE_NAME)?.value ?? null;
  try {
    return await createPreferencesApiHandler({
      rawToken,
      readSession: (token) => runtime.service.getCurrentSession(token),
      updateUiLanguage: ({ uiLanguage, context }) => runtime.service.updateUiLanguage({
        rawToken: rawToken!,
        uiLanguage,
        context,
      }),
    })(request);
  } finally {
    await runtime.close();
  }
}
