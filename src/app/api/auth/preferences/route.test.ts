import { describe, expect, it, vi } from "vitest";
import { createPreferencesApiHandler } from "@formal/app/api/auth/preferences/route";

const currentSession = {
  sessionId: 5,
  account: {
    id: 9,
    displayName: "LiJian",
    role: "super_admin" as const,
    mustChangePassword: false,
    delegatedPermissions: [] as "sensitive_operations.execute"[],
    uiLanguage: "zh" as const,
  },
  expiresAt: new Date("2026-08-29T00:00:00.000Z"),
};

describe("PATCH /api/auth/preferences", () => {
  it("saves the authenticated account language and returns the persisted value", async () => {
    const updateUiLanguage = vi.fn().mockResolvedValue("en");
    const PATCH = createPreferencesApiHandler({
      rawToken: "valid-token",
      readSession: vi.fn().mockResolvedValue(currentSession),
      updateUiLanguage,
    });

    const response = await PATCH(new Request("http://local/api/auth/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-request-id": "req-language-1" },
      body: JSON.stringify({ uiLanguage: "en" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uiLanguage: "en" });
    expect(updateUiLanguage).toHaveBeenCalledWith({
      accountId: 9,
      uiLanguage: "en",
      context: {
        requestId: "req-language-1",
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it("rejects missing authentication before parsing the body", async () => {
    const readSession = vi.fn();
    const updateUiLanguage = vi.fn();
    const PATCH = createPreferencesApiHandler({ rawToken: null, readSession, updateUiLanguage });

    const response = await PATCH(new Request("http://local/api/auth/preferences", {
      method: "PATCH",
      body: "not-json",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "unauthorized" });
    expect(readSession).not.toHaveBeenCalled();
    expect(updateUiLanguage).not.toHaveBeenCalled();
  });

  it.each(["fr", "", null, 1, { language: "en" }])("rejects invalid language %j", async (uiLanguage) => {
    const updateUiLanguage = vi.fn();
    const PATCH = createPreferencesApiHandler({
      rawToken: "valid-token",
      readSession: vi.fn().mockResolvedValue(currentSession),
      updateUiLanguage,
    });

    const response = await PATCH(new Request("http://local/api/auth/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uiLanguage }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid_ui_language" });
    expect(updateUiLanguage).not.toHaveBeenCalled();
  });
});
