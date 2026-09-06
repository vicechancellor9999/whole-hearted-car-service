import { z } from "zod";

const id = z.number().int().positive().refine(Number.isSafeInteger);
const schema = z.object({
  version: z.literal(1),
  accountId: id,
  businessOrderId: id,
  updatedAt: z.number().finite(),
  target: z.object({ roundId: id, roundNo: id, roundVersion: id, performanceMinor: z.number().int().refine(Number.isSafeInteger), handoffId: id.nullable() }),
  value: z.string().max(128),
  reason: z.string().max(10_000),
  unconfirmed: z.boolean(),
});
export type PerformanceRecoveryDraft = z.infer<typeof schema>;
const key = (accountId: number, businessOrderId: number) => `wh:performance-draft:v1:${accountId}:${businessOrderId}`;

export function readPerformanceDraft(accountId: number, businessOrderId: number): PerformanceRecoveryDraft | null {
  try {
    const raw = sessionStorage.getItem(key(accountId, businessOrderId));
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.businessOrderId !== businessOrderId
      || Date.now() - parsed.data.updatedAt > 86_400_000 || parsed.data.updatedAt > Date.now() + 60_000) {
      sessionStorage.removeItem(key(accountId, businessOrderId));
      return null;
    }
    return parsed.data;
  } catch { return null; }
}

/** Browser storage is best effort; the caller must show when recovery is unavailable. */
export function writePerformanceDraft(accountId: number, businessOrderId: number, draft: PerformanceRecoveryDraft | null): boolean {
  try {
    if (draft) {
      const parsed = schema.parse(draft);
      if (parsed.accountId !== accountId || parsed.businessOrderId !== businessOrderId) return false;
      sessionStorage.setItem(key(accountId, businessOrderId), JSON.stringify(parsed));
    } else {
      try { sessionStorage.removeItem(key(accountId, businessOrderId)); }
      catch {
        // A content-free tombstone also prevents an old draft from being restored.
        sessionStorage.setItem(key(accountId, businessOrderId), "null");
      }
    }
    return true;
  } catch { return false; }
}
