export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1_000;

export function getLoginFailureWindowStart(now: Date): Date {
  return new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
}

export function isLoginRateLimited(recentFailureCount: number): boolean {
  return recentFailureCount >= LOGIN_FAILURE_LIMIT;
}
