import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@formal/modules/auth/password";
import {
  AuthService,
  type AuthAccountRecord,
  type AuthRepository,
  type AuthSessionRecord,
  type LoginAuditRecord,
  type NewLoginSession,
} from "@formal/modules/auth/auth-service";
import { hashSessionToken } from "@formal/modules/auth/session-token";

const pepper = "0123456789abcdef0123456789abcdef";
const requestContext = {
  requestId: "req-auth-test-1",
  ipAddress: "127.0.0.1",
  userAgent: "Vitest",
};

class InMemoryAuthRepository implements AuthRepository {
  accounts: AuthAccountRecord[] = [];
  sessions: AuthSessionRecord[] = [];
  audits: LoginAuditRecord[] = [];
  nextSessionId = 1;

  async findAccountByNormalizedUsername(normalizedUsername: string) {
    return (
      this.accounts.find(
        (account) => account.normalizedUsername === normalizedUsername,
      ) ?? null
    );
  }

  async countRecentLoginFailures(
    normalizedUsername: string,
    ipAddress: string | null,
    since: Date,
  ) {
    const latestSuccess = this.audits
      .filter(
        (audit) =>
          audit.eventType === "auth.login_succeeded" &&
          audit.normalizedUsername === normalizedUsername &&
          audit.occurredAt >= since,
      )
      .at(-1)?.occurredAt;

    return this.audits.filter(
      (audit) =>
        audit.eventType === "auth.login_failed" &&
        audit.normalizedUsername === normalizedUsername &&
        audit.ipAddress === ipAddress &&
        audit.occurredAt >= since &&
        (!latestSuccess || audit.occurredAt > latestSuccess),
    ).length;
  }

  async recordLoginAudit(audit: LoginAuditRecord) {
    this.audits.push(audit);
  }

  async createLoginSession(input: NewLoginSession) {
    const session: AuthSessionRecord = {
      id: this.nextSessionId++,
      accountId: input.accountId,
      tokenHash: input.tokenHash,
      sessionEpoch: input.sessionEpoch,
      createdAt: input.createdAt,
      lastSeenAt: input.createdAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
      account: this.accounts.find((account) => account.id === input.accountId)!,
    };
    this.sessions.push(session);
    await this.recordLoginAudit(input.audit);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async refreshSessionActivity(tokenHash: string, lastSeenAt: Date) {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (session) session.lastSeenAt = lastSeenAt;
  }

  async revokeSession(tokenHash: string, revokedAt: Date, audit: LoginAuditRecord) {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (session && session.revokedAt === null) {
      session.revokedAt = revokedAt;
      await this.recordLoginAudit(audit);
    }
  }
}

describe("AuthService", () => {
  let repository: InMemoryAuthRepository;
  let service: AuthService;
  let account: AuthAccountRecord;

  beforeEach(async () => {
    repository = new InMemoryAuthRepository();
    account = {
      id: 1,
      displayName: "超级管理员",
      normalizedUsername: "admin",
      passwordHash: await hashPassword("Formal admin 2026!"),
      role: "super_admin",
      isActive: true,
      mustChangePassword: true,
      sessionEpoch: 1,
      delegatedPermissions: [],
    };
    repository.accounts.push(account);
    service = new AuthService(repository, {
      sessionTokenPepper: pepper,
      invalidPasswordHash: await hashPassword("Invalid login 2026!"),
    });
  });

  it("creates a database session for a case-normalized valid login", async () => {
    const now = new Date("2026-08-25T00:00:00.000Z");

    const result = await service.login({
      username: "  ＡDMIN ",
      password: "Formal admin 2026!",
      now,
      context: requestContext,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected login to succeed");
    expect(result.account).toEqual({
      id: 1,
      displayName: "超级管理员",
      role: "super_admin",
      mustChangePassword: true,
      delegatedPermissions: [],
    });
    expect(result.expiresAt).toEqual(new Date("2026-08-25T12:00:00.000Z"));
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]?.tokenHash).toBe(
      hashSessionToken(result.rawToken, pepper),
    );
    expect(repository.audits.map((audit) => audit.eventType)).toEqual([
      "auth.login_succeeded",
    ]);
  });

  it("returns the same public failure for an incorrect password and inactive account", async () => {
    const wrongPassword = await service.login({
      username: "admin",
      password: "Wrong password 2026!",
      now: new Date("2026-08-25T00:00:00.000Z"),
      context: requestContext,
    });
    account.isActive = false;
    const inactiveAccount = await service.login({
      username: "admin",
      password: "Formal admin 2026!",
      now: new Date("2026-08-25T00:01:00.000Z"),
      context: { ...requestContext, requestId: "req-auth-test-2" },
    });

    expect(wrongPassword).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(inactiveAccount).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(repository.sessions).toHaveLength(0);
    expect(repository.audits).toHaveLength(2);
  });

  it("does not reveal whether a normalized username exists", async () => {
    const result = await service.login({
      username: "missing",
      password: "Any password 2026!",
      now: new Date("2026-08-25T00:00:00.000Z"),
      context: requestContext,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(repository.sessions).toHaveLength(0);
    expect(repository.audits[0]).not.toHaveProperty("password");
  });

  it("blocks the sixth failed login within fifteen minutes", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.login({
        username: "admin",
        password: "Wrong password 2026!",
        now: new Date(`2026-08-25T00:0${attempt}:00.000Z`),
        context: { ...requestContext, requestId: `req-failed-${attempt}` },
      });
    }

    const result = await service.login({
      username: "admin",
      password: "Formal admin 2026!",
      now: new Date("2026-08-25T00:05:00.000Z"),
      context: { ...requestContext, requestId: "req-blocked" },
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(repository.sessions).toHaveLength(0);
  });

  it.each([
    ["expired", (session: AuthSessionRecord) => (session.expiresAt = new Date("2026-08-24T23:59:59Z"))],
    ["revoked", (session: AuthSessionRecord) => (session.revokedAt = new Date("2026-08-25T00:30:00Z"))],
    ["epoch mismatch", (session: AuthSessionRecord) => (session.account.sessionEpoch += 1)],
    ["inactive account", (session: AuthSessionRecord) => (session.account.isActive = false)],
  ])("rejects an %s database session", async (_label, invalidate) => {
    const login = await service.login({
      username: "admin",
      password: "Formal admin 2026!",
      now: new Date("2026-08-25T00:00:00.000Z"),
      context: requestContext,
    });
    if (!login.ok) throw new Error("expected login to succeed");
    invalidate(repository.sessions[0]!);

    const currentSession = await service.getCurrentSession(
      login.rawToken,
      new Date("2026-08-25T01:00:00.000Z"),
    );

    expect(currentSession).toBeNull();
  });

  it("records the latest activity time after validating a session", async () => {
    const login = await service.login({
      username: "admin",
      password: "Formal admin 2026!",
      now: new Date("2026-08-25T00:00:00.000Z"),
      context: requestContext,
    });
    if (!login.ok) throw new Error("expected login to succeed");

    await service.getCurrentSession(
      login.rawToken,
      new Date("2026-08-25T01:00:00.000Z"),
    );

    expect(repository.sessions[0]?.lastSeenAt).toEqual(
      new Date("2026-08-25T01:00:00.000Z"),
    );
  });

  it("revokes the current database session on logout", async () => {
    const login = await service.login({
      username: "admin",
      password: "Formal admin 2026!",
      now: new Date("2026-08-25T00:00:00.000Z"),
      context: requestContext,
    });
    if (!login.ok) throw new Error("expected login to succeed");

    await service.logout({
      rawToken: login.rawToken,
      now: new Date("2026-08-25T01:00:00.000Z"),
      context: { ...requestContext, requestId: "req-logout" },
    });

    expect(repository.sessions[0]?.revokedAt).toEqual(
      new Date("2026-08-25T01:00:00.000Z"),
    );
    await expect(
      service.getCurrentSession(
        login.rawToken,
        new Date("2026-08-25T01:01:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(repository.audits.at(-1)?.eventType).toBe("auth.logout");
  });
});
