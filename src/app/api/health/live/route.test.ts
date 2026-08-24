import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/live/route";

describe("GET /api/health/live", () => {
  it("reports that the web process is alive without exposing internals", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "alive" });
  });
});
