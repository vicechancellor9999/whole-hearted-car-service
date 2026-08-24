import { normalizeUsername, verifyPassword } from "@/modules/auth/password";
import {
  getLoginFailureWindowStart,
  isLoginRateLimited,
} from "@/modules/auth/login-rate-limit";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_DURATION_MS,
} from "@/modules/auth/session-token";

export type AccountRole = "super_admin" | "front_desk" | "owner" | "mechanic";

export type AuthAccountRecord = {
  id: number;
  displayName: string;
  normalizedUsername: string;
  passwordHash: string;
  role: AccountRole;
  isActive: boolean;
  mustChangePassword: boolean;
  sessionEpoch: number;
};

export type AuthSessionRecord = {
  id: number;
  accountId: number;
  tokenHash: string;
  sessionEpoch: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  account: AuthAccountRecord;
};

export type LoginAuditEventType =
  | "auth.login_failed"
  | "auth.login_rate_limited"
  | "auth.login_succeeded"
  | "auth.logout";

export type LoginAuditRecord = {
  eventType: LoginAuditEventType;
  normalizedUsername: string;
  accountId: number | null;
  occurredAt: Date;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type NewLoginSession = {
  accountId: number;
  tokenHash: string;
  sessionEpoch: number;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  audit: LoginAuditRecord;
};

export interface AuthRepository {
  findAccountByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<AuthAccountRecord | null>;
  countRecentLoginFailures(
    normalizedUsername: string,
    ipAddress: string | null,
    since: Date,
  ): Promise<number>;
  recordLoginAudit(audit: LoginAuditRecord): Promise<void>;
  createLoginSession(input: NewLoginSession): Promise<AuthSessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  refreshSessionActivity(tokenHash: string, lastSeenAt: Date): Promise<void>;
  revokeSession(
    tokenHash: string,
    revokedAt: Date,
    audit: LoginAuditRecord,
  ): Promise<void>;
}

export type AuthRequestContext = {
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuthenticatedAccount = {
  id: number;
  displayName: string;
  role: AccountRole;
  mustChangePassword: boolean;
};

export type CurrentSession = {
  sessionId: number;
  account: AuthenticatedAccount;
  expiresAt: Date;
};

export type LoginResult =
  | {
      ok: true;
      rawToken: string;
      expiresAt: Date;
      account: AuthenticatedAccount;
    }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" };

type AuthServiceOptions = {
  sessionTokenPepper: string;
  invalidPasswordHash: string;
};

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly options: AuthServiceOptions,
  ) {}

  async login(input: {
    username: string;
    password: string;
    now?: Date;
    context: AuthRequestContext;
  }): Promise<LoginResult> {
    const now = input.now ?? new Date();
    const normalizedUsername = normalizeUsername(input.username);
    const ipAddress = input.context.ipAddress ?? null;
    const userAgent = input.context.userAgent ?? null;
    const recentFailures = await this.repository.countRecentLoginFailures(
      normalizedUsername,
      ipAddress,
      getLoginFailureWindowStart(now),
    );

    if (isLoginRateLimited(recentFailures)) {
      await this.repository.recordLoginAudit({
        eventType: "auth.login_rate_limited",
        normalizedUsername,
        accountId: null,
        occurredAt: now,
        requestId: input.context.requestId,
        ipAddress,
        userAgent,
      });
      return { ok: false, reason: "rate_limited" };
    }

    const account = await this.repository.findAccountByNormalizedUsername(
      normalizedUsername,
    );
    const passwordMatches = await verifyPassword(
      account?.passwordHash ?? this.options.invalidPasswordHash,
      input.password,
    );

    if (!account || !account.isActive || !passwordMatches) {
      await this.repository.recordLoginAudit({
        eventType: "auth.login_failed",
        normalizedUsername,
        accountId: account?.id ?? null,
        occurredAt: now,
        requestId: input.context.requestId,
        ipAddress,
        userAgent,
      });
      return { ok: false, reason: "invalid_credentials" };
    }

    const rawToken = generateSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await this.repository.createLoginSession({
      accountId: account.id,
      tokenHash: hashSessionToken(rawToken, this.options.sessionTokenPepper),
      sessionEpoch: account.sessionEpoch,
      createdAt: now,
      expiresAt,
      ipAddress,
      userAgent,
      audit: {
        eventType: "auth.login_succeeded",
        normalizedUsername,
        accountId: account.id,
        occurredAt: now,
        requestId: input.context.requestId,
        ipAddress,
        userAgent,
      },
    });

    return {
      ok: true,
      rawToken,
      expiresAt,
      account: toAuthenticatedAccount(account),
    };
  }

  async getCurrentSession(rawToken: string, now = new Date()): Promise<CurrentSession | null> {
    const tokenHash = hashSessionToken(rawToken, this.options.sessionTokenPepper);
    const session = await this.repository.findSessionByTokenHash(tokenHash);

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      !session.account.isActive ||
      session.sessionEpoch !== session.account.sessionEpoch
    ) {
      return null;
    }

    await this.repository.refreshSessionActivity(tokenHash, now);

    return {
      sessionId: session.id,
      account: toAuthenticatedAccount(session.account),
      expiresAt: session.expiresAt,
    };
  }

  async logout(input: {
    rawToken: string;
    now?: Date;
    context: AuthRequestContext;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const tokenHash = hashSessionToken(
      input.rawToken,
      this.options.sessionTokenPepper,
    );
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    if (!session) return;

    await this.repository.revokeSession(tokenHash, now, {
      eventType: "auth.logout",
      normalizedUsername: session.account.normalizedUsername,
      accountId: session.account.id,
      occurredAt: now,
      requestId: input.context.requestId,
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
    });
  }
}

function toAuthenticatedAccount(account: AuthAccountRecord): AuthenticatedAccount {
  return {
    id: account.id,
    displayName: account.displayName,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  };
}
