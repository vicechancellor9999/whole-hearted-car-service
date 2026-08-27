import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthRuntime } from "@formal/modules/auth/auth-runtime";
import type { CurrentSession } from "@formal/modules/auth/auth-service";

type SessionApiDependencies = {
  rawToken: string | null;
  readSession(rawToken: string): Promise<CurrentSession | null>;
};

export function createSessionApiHandler(dependencies: SessionApiDependencies) {
  return async function sessionApiHandler(): Promise<Response> {
    if (!dependencies.rawToken) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const session = await dependencies.readSession(dependencies.rawToken);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      account: session.account,
      expiresAt: session.expiresAt.toISOString(),
    });
  };
}

export async function GET(): Promise<Response> {
  const runtime = createAuthRuntime(process.env);
  const rawToken = (await cookies()).get(runtime.env.SESSION_COOKIE_NAME)?.value ?? null;
  try {
    return await createSessionApiHandler({
      rawToken,
      readSession: (token) => runtime.service.getCurrentSession(token),
    })();
  } finally {
    await runtime.close();
  }
}
