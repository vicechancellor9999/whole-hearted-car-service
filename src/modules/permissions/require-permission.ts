import type {
  AuthenticatedAccount,
  CurrentSession,
} from "@/modules/auth/auth-service";
import {
  hasPermission,
  type Permission,
} from "@/modules/permissions/permissions";

export class AuthenticationRequiredError extends Error {
  readonly status = 401;
  readonly code = "authentication_required";

  constructor() {
    super("需要登录");
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  readonly status = 403;
  readonly code = "permission_denied";

  constructor() {
    super("无权执行此操作");
    this.name = "AuthorizationDeniedError";
  }
}

export function requirePermission(
  session: CurrentSession | null,
  permission: Permission,
  delegatedPermissions: readonly Permission[] = [],
): AuthenticatedAccount {
  if (!session) {
    throw new AuthenticationRequiredError();
  }
  if (!hasPermission(session.account.role, permission, delegatedPermissions)) {
    throw new AuthorizationDeniedError();
  }
  return session.account;
}
