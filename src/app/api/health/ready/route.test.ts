import { describe, expect, it } from "vitest";
import { createReadinessHandler } from "@/app/api/health/ready/route";

describe("GET /api/health/ready", () => {
  it("reports ready only after the database check succeeds", async () => {
    const GET = createReadinessHandler(async () => undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns 503 without leaking the database error", async () => {
    const GET = createReadinessHandler(async () => {
      throw new Error("postgres://secret-user:secret-password@db/private");
    });

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "not_ready" });
    expect(body).not.toContain("secret-user");
    expect(body).not.toContain("secret-password");
  });
});
