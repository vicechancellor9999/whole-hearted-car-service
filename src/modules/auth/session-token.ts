import { createHmac, randomBytes } from "node:crypto";

export const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;

export type RuntimeMode = "development" | "test" | "production";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(rawToken: string, pepper: string): string {
  if (pepper.length < 32) {
    throw new Error("会话密钥至少需要 32 个字符");
  }

  return createHmac("sha256", pepper).update(rawToken, "utf8").digest("hex");
}

export function getSessionCookieOptions(mode: RuntimeMode, now = new Date()) {
  return {
    httpOnly: true as const,
    secure: mode === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    expires: new Date(now.getTime() + SESSION_DURATION_MS),
  };
}
