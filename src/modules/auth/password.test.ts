import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeUsername,
  validateNewPassword,
  verifyPassword,
} from "@formal/modules/auth/password";

describe("password authentication", () => {
  it("stores an Argon2id hash that verifies only the original password", async () => {
    const password = "Correct horse 2026!";

    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "Wrong horse 2026!")).resolves.toBe(
      false,
    );
  });

  it("rejects a new password shorter than twelve characters", () => {
    expect(validateNewPassword("12345678901")).toEqual({
      ok: false,
      message: "密码至少需要 12 个字符",
    });
    expect(validateNewPassword("123456789012")).toEqual({ ok: true });
  });

  it("normalizes surrounding whitespace, width and letter case in usernames", () => {
    expect(normalizeUsername("  Ｆront.Desk  ")).toBe("front.desk");
  });
});
