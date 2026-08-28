import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getUnifiedRuntimeConfig } from "./dev-unified";

const candidateRoot = "/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime";

describe("unified Whole Hearted runtime config", () => {
  it("builds the candidate with formal browser flags at compile time", () => {
    const packageJson = JSON.parse(readFileSync(resolve(candidateRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.build).toContain("NEXT_PUBLIC_USE_MOCK=false");
    expect(packageJson.scripts?.build).toContain("NEXT_PUBLIC_FORMAL_AUTH=true");
    expect(packageJson.scripts?.build).toContain("NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE=true");
  });

  it("resolves one Web app and isolated database entirely on the external volume", () => {
    const config = getUnifiedRuntimeConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@127.0.0.1:5432/wholehearted",
      SESSION_TOKEN_PEPPER: "test-pepper-that-is-long-enough-for-runtime",
      UNIFIED_APP_PORT: "3220",
      UNIFIED_DATABASE_PORT: "55433",
      UNIFIED_NEXT_MODE: "start",
      UNIFIED_APP_ORIGIN: "http://127.0.0.1:3220",
    }, candidateRoot);

    expect(config).toMatchObject({
      projectRoot: candidateRoot,
      webRoot: `${candidateRoot}/apps/web`,
      appHost: "127.0.0.1",
      appPort: 3220,
      appOrigin: "http://127.0.0.1:3220",
      nextMode: "start",
      database: {
        databaseDir: `${candidateRoot}/.runtime/postgresql`,
        port: 55433,
        uploadRoot: `${candidateRoot}/.runtime/uploads`,
      },
    });
    expect(new URL(config.databaseUrl).port).toBe("55433");
    expect(config.childEnvironment).toMatchObject({
      APP_ORIGIN: "http://127.0.0.1:3220",
      DATABASE_URL: config.databaseUrl,
      NEXT_PUBLIC_FORMAL_AUTH: "true",
      NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE: "true",
      NEXT_PUBLIC_USE_MOCK: "false",
    });
    expect(config.childEnvironment).not.toHaveProperty("FORMAL_BACKEND_ORIGIN");
  });

  it("rejects a runtime path outside the mounted company volume", () => {
    expect(() => getUnifiedRuntimeConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@127.0.0.1:5432/wholehearted",
      UNIFIED_APP_PORT: "3220",
      UNIFIED_DATABASE_PORT: "55433",
      UNIFIED_APP_ORIGIN: "http://127.0.0.1:3220",
    }, "/Users/lijianfu/whole-hearted"))
      .toThrow("外置卷");
  });

  it("rejects an origin whose port does not identify the one app", () => {
    expect(() => getUnifiedRuntimeConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@127.0.0.1:5432/wholehearted",
      UNIFIED_APP_PORT: "3220",
      UNIFIED_DATABASE_PORT: "55433",
      UNIFIED_APP_ORIGIN: "http://127.0.0.1:3211",
    }, candidateRoot)).toThrow("APP_ORIGIN");
  });
});
