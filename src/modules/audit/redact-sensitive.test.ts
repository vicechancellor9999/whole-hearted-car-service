import { describe, expect, it } from "vitest";
import { redactSensitive } from "@/modules/audit/redact-sensitive";

describe("redactSensitive", () => {
  it("redacts secrets recursively without mutating the source audit state", () => {
    const source = {
      displayName: "前台一号",
      password: "Formal secret 2026!",
      passwordHash: "$argon2id$secret-hash",
      passwordLength: 19,
      session: {
        rawToken: "raw-session-token",
        sessionEpoch: 3,
      },
      environment: {
        DATABASE_URL: "postgres://user:password@database/formal",
        safeMode: "formal",
      },
      attachments: [
        { name: "refund-proof.jpg", fileContent: "base64-secret-content" },
      ],
      mustChangePassword: true,
    };

    expect(redactSensitive(source)).toEqual({
      displayName: "前台一号",
      password: "[REDACTED]",
      passwordHash: "[REDACTED]",
      passwordLength: "[REDACTED]",
      session: {
        rawToken: "[REDACTED]",
        sessionEpoch: 3,
      },
      environment: {
        DATABASE_URL: "[REDACTED]",
        safeMode: "formal",
      },
      attachments: [
        { name: "refund-proof.jpg", fileContent: "[REDACTED]" },
      ],
      mustChangePassword: true,
    });
    expect(source.password).toBe("Formal secret 2026!");
    expect(source.session.rawToken).toBe("raw-session-token");
  });

  it("redacts a database connection string or bearer credential hidden in a free-text value", () => {
    expect(
      redactSensitive({
        note: "failed to use postgres://user:password@database/formal",
        authorization: "Bearer secret-session-token",
        reason: "管理员主动停用账号",
      }),
    ).toEqual({
      note: "[REDACTED]",
      authorization: "[REDACTED]",
      reason: "管理员主动停用账号",
    });
  });
});
