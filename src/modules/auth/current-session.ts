import { cookies } from "next/headers";
import { parseAppEnv } from "@formal/lib/env";
import type { CurrentSession } from "@formal/modules/auth/auth-service";
import { createAuthRuntime } from "@formal/modules/auth/auth-runtime";

export interface CurrentSessionReader {
  getCurrentSession(rawToken: string): Promise<CurrentSession | null>;
}

export function resolveCurrentSession(
  rawToken: string | undefined,
  reader: CurrentSessionReader,
): Promise<CurrentSession | null> {
  if (!rawToken) return Promise.resolve(null);
  return reader.getCurrentSession(rawToken);
}

export async function currentSession(): Promise<CurrentSession | null> {
  const env = parseAppEnv(process.env);
  const rawToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const runtime = createAuthRuntime(process.env);
  try {
    return await resolveCurrentSession(rawToken, runtime.service);
  } finally {
    await runtime.close();
  }
}
