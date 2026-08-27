import { describe, expect, it } from "vitest";
import { parseAppEnv } from "@formal/lib/env";

const validProductionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://wholehearted:secret@db:5432/wholehearted",
  APP_ORIGIN: "https://garage.example.com",
  APP_TIMEZONE: "America/Jamaica",
  SESSION_COOKIE_NAME: "wh_session",
  SESSION_TOKEN_PEPPER: "0123456789abcdef0123456789abcdef",
  UPLOAD_ROOT: "/srv/wholehearted/uploads",
};

describe("parseAppEnv", () => {
  it("accepts the complete production configuration", () => {
    expect(parseAppEnv(validProductionEnv)).toEqual(validProductionEnv);
  });

  it("rejects production without a database connection", () => {
    expect(() =>
      parseAppEnv({ ...validProductionEnv, DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a business timezone other than Jamaica", () => {
    expect(() =>
      parseAppEnv({ ...validProductionEnv, APP_TIMEZONE: "UTC" }),
    ).toThrow(/APP_TIMEZONE/);
  });

  it("rejects a session token pepper shorter than 32 characters", () => {
    expect(() =>
      parseAppEnv({ ...validProductionEnv, SESSION_TOKEN_PEPPER: "too-short" }),
    ).toThrow(/SESSION_TOKEN_PEPPER/);
  });

  it("requires HTTPS for the production origin", () => {
    expect(() =>
      parseAppEnv({
        ...validProductionEnv,
        APP_ORIGIN: "http://garage.example.com",
      }),
    ).toThrow(/APP_ORIGIN/);
  });

  it("keeps a test database isolated from the production address", () => {
    const parsed = parseAppEnv({
      ...validProductionEnv,
      NODE_ENV: "test",
      DATABASE_URL: "postgres://wholehearted:test@db:5432/wholehearted_test",
      APP_ORIGIN: "http://127.0.0.1:3211",
    });

    expect(parsed.DATABASE_URL).toBe(
      "postgres://wholehearted:test@db:5432/wholehearted_test",
    );
  });
});
