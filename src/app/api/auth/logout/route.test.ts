import { describe, expect, it, vi } from "vitest";
import { createLogoutApiHandler } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("revokes the database session and expires the host cookie", async () => {
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const POST = createLogoutApiHandler({
      rawToken: "valid-token",
      revokeSession,
      cookieName: "wh_session",
    });

    const response = await POST(new Request("http://localhost/api/auth/logout", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith("valid-token", expect.objectContaining({ requestId: expect.any(String) }));
    expect(response.headers.get("set-cookie")).toContain("wh_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
