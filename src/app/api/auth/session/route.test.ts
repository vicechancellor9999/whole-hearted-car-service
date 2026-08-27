import { describe, expect, it, vi } from "vitest";
import { createSessionApiHandler } from "@/app/api/auth/session/route";

describe("GET /api/auth/session", () => {
  it("returns the database-validated account", async () => {
    const readSession = vi.fn().mockResolvedValue({
      sessionId: 5,
      account: {
        id: 1,
        displayName: "超级管理员",
        role: "super_admin",
        mustChangePassword: false,
        delegatedPermissions: [],
      },
      expiresAt: new Date("2026-08-24T22:00:00.000Z"),
    });
    const GET = createSessionApiHandler({ rawToken: "valid-token", readSession });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      account: {
        id: 1,
        displayName: "超级管理员",
        role: "super_admin",
        mustChangePassword: false,
        delegatedPermissions: [],
      },
      expiresAt: "2026-08-24T22:00:00.000Z",
    });
    expect(readSession).toHaveBeenCalledWith("valid-token");
  });

  it("rejects a missing or invalid session", async () => {
    const missing = createSessionApiHandler({ rawToken: null, readSession: vi.fn() });
    const invalid = createSessionApiHandler({
      rawToken: "expired-token",
      readSession: vi.fn().mockResolvedValue(null),
    });

    expect((await missing()).status).toBe(401);
    expect((await invalid()).status).toBe(401);
  });
});
