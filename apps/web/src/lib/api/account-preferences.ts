import type { UiLanguage } from "@/lib/i18n/language";

export async function saveAccountUiLanguage(
  uiLanguage: UiLanguage,
  fetcher: typeof fetch = fetch,
): Promise<UiLanguage> {
  const response = await fetcher("/api/formal/auth/preferences", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uiLanguage }),
  });
  const payload = await response.json().catch(() => ({})) as {
    uiLanguage?: unknown;
    code?: unknown;
  };
  if (!response.ok || (payload.uiLanguage !== "zh" && payload.uiLanguage !== "en")) {
    throw new Error(typeof payload.code === "string" ? payload.code : "language_preference_save_failed");
  }
  return payload.uiLanguage;
}
